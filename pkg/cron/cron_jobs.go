package cron

import (
	"math/big"
	"time"

	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/exchangerates"
	"github.com/mayswind/ezbookkeeping/pkg/services"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
)

// RemoveExpiredTokensJob represents the cron job which periodically remove expired user tokens from the database
var RemoveExpiredTokensJob = &CronJob{
	Name:        "RemoveExpiredTokens",
	Description: "Periodically remove expired user tokens from the database.",
	Period: CronJobFixedHourPeriod{
		Hour: 0,
	},
	Run: func(c *core.CronContext) error {
		return services.Tokens.DeleteAllExpiredTokens(c)
	},
}

// CreateScheduledTransactionJob represents the cron job which periodically create transaction by scheduled transaction template
var CreateScheduledTransactionJob = &CronJob{
	Name:        "CreateScheduledTransaction",
	Description: "Periodically create transaction by scheduled transaction template.",
	Period: CronJobEvery15MinutesPeriod{
		Second: 0,
	},
	Run: func(c *core.CronContext) error {
		return services.Transactions.CreateScheduledTransactions(c, time.Now().Unix(), c.GetInterval(), getLatestExchangeRate)
	},
}

// getLatestExchangeRate returns the rate to convert from one currency to another by the latest exchange rates of the user
func getLatestExchangeRate(c core.Context, uid int64, fromCurrency string, toCurrency string) (*big.Rat, error) {
	exchangeRates, err := exchangerates.Container.GetLatestExchangeRates(c, uid, settings.Container.GetCurrentConfig())

	if err != nil {
		return nil, err
	}

	rates := make(map[string]*big.Rat, len(exchangeRates.ExchangeRates)+1)
	rates[exchangeRates.BaseCurrency] = big.NewRat(1, 1)

	for _, exchangeRate := range exchangeRates.ExchangeRates {
		if rate, ok := new(big.Rat).SetString(exchangeRate.Rate); ok && rate.Sign() > 0 {
			rates[exchangeRate.Currency] = rate
		}
	}

	fromRate, fromOk := rates[fromCurrency]
	toRate, toOk := rates[toCurrency]

	if !fromOk || !toOk {
		return nil, errs.ErrTransactionExchangeRateNotFound
	}

	return new(big.Rat).Quo(toRate, fromRate), nil
}
