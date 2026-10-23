package api

import (
	"github.com/mayswind/ezbookkeeping/pkg/core"
	"github.com/mayswind/ezbookkeeping/pkg/errs"
	"github.com/mayswind/ezbookkeeping/pkg/log"
	"github.com/mayswind/ezbookkeeping/pkg/models"
	"github.com/mayswind/ezbookkeeping/pkg/services"
	"github.com/mayswind/ezbookkeeping/pkg/settings"
	"github.com/mayswind/ezbookkeeping/pkg/typesafe"
)

const maxReceiptItemsCountPerClassification = 100
const maxReceiptItemCategoryAlternatives = 3

// ReceiptItemsApi represents receipt items api
type ReceiptItemsApi struct {
	ApiUsingConfig
	transactionCategories *services.TransactionCategoryService
	users                 *services.UserService
}

// Initialize a receipt items api singleton instance
var (
	ReceiptItems = &ReceiptItemsApi{
		ApiUsingConfig: ApiUsingConfig{
			container: settings.Container,
		},
		transactionCategories: services.TransactionCategories,
		users:                 services.Users,
	}
)

// ClassifyReceiptItemsHandler returns the expense category of each receipt item classified by TypeSafe System One
func (a *ReceiptItemsApi) ClassifyReceiptItemsHandler(c *core.WebContext) (any, *errs.Error) {
	if !typesafe.IsSystemOneEnabled(a.CurrentConfig()) {
		return nil, errs.ErrReceiptItemsClassificationNotEnabled
	}

	uid := c.GetCurrentUid()
	user, err := a.users.GetUserById(c, uid)

	if err != nil {
		if !errs.IsCustomError(err) {
			log.Warnf(c, "[receipt_items.ClassifyReceiptItemsHandler] failed to get user for user \"uid:%d\", because %s", uid, err.Error())
		}

		return nil, errs.ErrUserNotFound
	}

	if user.FeatureRestriction.Contains(core.USER_FEATURE_RESTRICTION_TYPE_CREATE_TRANSACTION_FROM_AI_TEXT_RECOGNITION) {
		return nil, errs.ErrNotPermittedToPerformThisAction
	}

	var classificationReq models.ReceiptItemsClassificationRequest
	err = c.ShouldBindJSON(&classificationReq)

	if err != nil {
		log.Warnf(c, "[receipt_items.ClassifyReceiptItemsHandler] parse request failed, because %s", err.Error())
		return nil, errs.NewIncompleteOrIncorrectSubmissionError(err)
	}

	if len(classificationReq.Items) < 1 {
		return nil, errs.ErrNoReceiptItemsToClassify
	}

	if len(classificationReq.Items) > maxReceiptItemsCountPerClassification {
		return nil, errs.ErrTooManyReceiptItemsToClassify
	}

	categories, err := a.transactionCategories.GetAllCategoriesByUid(c, uid, models.CATEGORY_TYPE_EXPENSE, -1)

	if err != nil {
		log.Errorf(c, "[receipt_items.ClassifyReceiptItemsHandler] failed to get categories for user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.Or(err, errs.ErrOperationFailed)
	}

	options := typesafe.BuildExpenseCategoryOptions(categories)

	if len(options.Names) < 1 {
		return nil, errs.ErrNoAvailableExpenseCategory
	}

	state, questions := typesafe.BuildReceiptItemsQuestions(&classificationReq, options)
	response, err := typesafe.NewSystemOneClient(a.CurrentConfig()).Ask(c, uid, state, questions)

	if err != nil {
		return nil, errs.Or(err, errs.ErrOperationFailed)
	}

	items, err := typesafe.ParseReceiptItemsAnswers(response, len(classificationReq.Items), options, maxReceiptItemCategoryAlternatives)

	if err != nil {
		log.Errorf(c, "[receipt_items.ClassifyReceiptItemsHandler] failed to parse answers for user \"uid:%d\", because %s", uid, err.Error())
		return nil, errs.ErrFailedToRequestRemoteApi
	}

	return &models.ReceiptItemsClassificationResponse{
		Items: items,
	}, nil
}
