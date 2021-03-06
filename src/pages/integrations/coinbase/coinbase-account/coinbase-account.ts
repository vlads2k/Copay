import { Component, NgZone } from '@angular/core';
import { StatusBar } from '@ionic-native/status-bar';
import { TranslateService } from '@ngx-translate/core';
import { ModalController, NavController, NavParams } from 'ionic-angular';
import { Logger } from '../../../../providers/logger/logger';

import * as _ from 'lodash';

// providers
import { ActionSheetProvider } from '../../../../providers/action-sheet/action-sheet';
import { CoinbaseProvider } from '../../../../providers/coinbase/coinbase';
import { IncomingDataProvider } from '../../../../providers/incoming-data/incoming-data';
import { OnGoingProcessProvider } from '../../../../providers/on-going-process/on-going-process';
import { PlatformProvider } from '../../../../providers/platform/platform';
import { PopupProvider } from '../../../../providers/popup/popup';
import { ProfileProvider } from '../../../../providers/profile/profile';

// Page
import { AmountPage } from '../../../send/amount/amount';
import { CoinbaseTxDetailsPage } from '../coinbase-tx-details/coinbase-tx-details';

const TIMEOUT_FOR_REFRESHER = 1000;

@Component({
  selector: 'page-coinbase-account',
  templateUrl: 'coinbase-account.html'
})
export class CoinbaseAccountPage {
  public id: string;
  public isCordova: boolean;
  public data: object = {};
  public nativeCurrency;
  private zone;

  constructor(
    private actionSheetProvider: ActionSheetProvider,
    private coinbase: CoinbaseProvider,
    private logger: Logger,
    private popupProvider: PopupProvider,
    private navCtrl: NavController,
    private navParams: NavParams,
    private modalCtrl: ModalController,
    private platformProvider: PlatformProvider,
    private profileProvider: ProfileProvider,
    private statusBar: StatusBar,
    private translate: TranslateService,
    private incomingDataProvider: IncomingDataProvider,
    protected onGoingProcessProvider: OnGoingProcessProvider
  ) {
    this.zone = new NgZone({ enableLongStackTrace: false });
    this.id = this.navParams.data.id;
    this.isCordova = this.platformProvider.isCordova;
  }

  ionViewDidLoad() {
    this.logger.info('Loaded: CoinbaseAccountPage');
  }

  ionViewWillEnter() {
    if (this.platformProvider.isIOS) {
      this.statusBar.styleLightContent();
    }
    this.updateAll();
  }

  ionViewWillLeave() {
    if (this.platformProvider.isIOS) {
      this.statusBar.styleDefault();
    }
  }

  private updateAll() {
    this.zone.run(() => {
      this.nativeCurrency = this.coinbase.coinbaseData['user'][
        'native_currency'
      ];
      this.coinbase.getAccount(this.id, this.data);
      this.coinbase.getTransactions(this.id, this.data);
    });
  }

  private debounceUpdateAll = _.debounce(
    async () => {
      this.updateAll();
    },
    5000,
    {
      leading: true
    }
  );

  public doRefresh(refresher) {
    this.debounceUpdateAll();

    setTimeout(() => {
      refresher.complete();
    }, TIMEOUT_FOR_REFRESHER);
  }

  public showErrorAndBack(err): void {
    this.logger.error(err);
    err = err.errors ? err.errors[0].message : err;
    this.popupProvider
      .ionicAlert(this.translate.instant('Error'), err)
      .then(() => {
        this.navCtrl.pop();
      });
  }

  public showError(err): void {
    this.logger.error(err);
    err = err.errors ? err.errors[0].message : err;
    this.popupProvider.ionicAlert(this.translate.instant('Error'), err);
  }

  public getNativeBalance(): string {
    if (!this.data['account']) return null;
    return this.coinbase.getNativeCurrencyBalance(
      this.data['account'].balance.amount,
      this.data['account'].balance.currency
    );
  }

  public openTx(tx) {
    let modal = this.modalCtrl.create(CoinbaseTxDetailsPage, { tx });
    modal.present();
  }

  public deposit(): void {
    const account_name = this.data['account'].name;
    const coin = this.data['account'].currency.code.toLowerCase();
    const wallets = this.profileProvider.getWallets({
      onlyComplete: true,
      network: 'livenet',
      hasFunds: true,
      coin
    });

    if (_.isEmpty(wallets)) {
      this.showError(this.translate.instant('No wallet available to deposit'));
      return;
    }

    const params = {
      wallets,
      selectedWalletId: null,
      title: this.translate.instant('Transfer from')
    };
    const walletSelector = this.actionSheetProvider.createWalletSelector(
      params
    );
    walletSelector.present();
    walletSelector.onDidDismiss(fromWallet => {
      if (!fromWallet) return;
      this.onGoingProcessProvider.set('generatingNewAddress');
      this.coinbase
        .getAddress(
          this.id,
          this.translate.instant('Transfer from BitPay') +
            ': ' +
            fromWallet.name
        )
        .then(data => {
          let toAddress = data.address;
          let destinationTag;
          if (coin == 'xrp' || coin == 'bch') {
            toAddress = this.incomingDataProvider.extractAddress(
              data.deposit_uri
            );
            const tagParam = /[\?\&]dt=(\d+([\,\.]\d+)?)/i;
            if (tagParam.exec(data.deposit_uri)) {
              destinationTag = tagParam.exec(data.deposit_uri)[1];
            }
          }
          this.onGoingProcessProvider.clear();
          this.navCtrl.push(AmountPage, {
            currency: this.nativeCurrency,
            coin,
            walletId: fromWallet.id,
            fromWalletDetails: true,
            toAddress,
            destinationTag,
            description:
              this.translate.instant('Deposit to') + ': ' + account_name,
            recipientType: 'coinbase',
            fromCoinbase: { accountId: this.id, accountName: account_name }
          });
        });
    });
  }

  public withdraw(): void {
    const coin = this.data['account'].currency.code.toLowerCase();
    const wallets = this.profileProvider.getWallets({
      onlyComplete: true,
      backedUp: true,
      network: 'livenet',
      coin
    });

    if (_.isEmpty(wallets)) {
      this.showError(this.translate.instant('No wallet available to withdraw'));
      return;
    }

    const params = {
      wallets,
      selectedWalletId: null,
      title: this.translate.instant('Transfer to')
    };
    const walletSelector = this.actionSheetProvider.createWalletSelector(
      params
    );
    walletSelector.present();
    walletSelector.onDidDismiss(toWallet => {
      if (!toWallet) return;
      this.navCtrl.push(AmountPage, {
        id: this.id,
        toWalletId: toWallet.id,
        currency: this.nativeCurrency,
        coin,
        nextPage: 'CoinbaseWithdrawPage',
        description:
          this.translate.instant('Transfer to BitPay') + ': ' + toWallet.name
      });
    });
  }
}
