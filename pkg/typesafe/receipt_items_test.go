package typesafe

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/mayswind/ezbookkeeping/pkg/models"
)

func newTestCategory(id int64, parentId int64, name string, displayOrder int32, hidden bool) *models.TransactionCategory {
	return &models.TransactionCategory{
		CategoryId:       id,
		ParentCategoryId: parentId,
		Type:             models.CATEGORY_TYPE_EXPENSE,
		Name:             name,
		DisplayOrder:     displayOrder,
		Hidden:           hidden,
	}
}

func TestBuildExpenseCategoryOptions_OrderedByPrimaryAndSecondaryDisplayOrder(t *testing.T) {
	categories := []*models.TransactionCategory{
		newTestCategory(20, 0, "Boat Spare Parts", 2, false),
		newTestCategory(10, 0, "Food & Drink", 1, false),
		newTestCategory(22, 20, "Ropes", 2, false),
		newTestCategory(21, 20, "Plumbing", 1, false),
		newTestCategory(11, 10, "Food", 1, false),
	}

	options := BuildExpenseCategoryOptions(categories)

	assert.Equal(t, []string{"Food & Drink > Food", "Boat Spare Parts > Plumbing", "Boat Spare Parts > Ropes"}, options.Names)
	assert.Equal(t, int64(11), options.CategoryIds["Food & Drink > Food"])
	assert.Equal(t, int64(22), options.CategoryIds["Boat Spare Parts > Ropes"])
}

func TestBuildExpenseCategoryOptions_SkipsHiddenAndOtherTypes(t *testing.T) {
	income := newTestCategory(31, 30, "Salary", 1, false)
	income.Type = models.CATEGORY_TYPE_INCOME

	categories := []*models.TransactionCategory{
		newTestCategory(10, 0, "Food & Drink", 1, false),
		newTestCategory(11, 10, "Food", 1, false),
		newTestCategory(12, 10, "Old Snacks", 2, true),
		newTestCategory(20, 0, "Hidden Group", 2, true),
		newTestCategory(21, 20, "Visible Child Of Hidden Group", 1, false),
		income,
	}

	options := BuildExpenseCategoryOptions(categories)

	assert.Equal(t, []string{"Food & Drink > Food"}, options.Names)
}

func TestBuildExpenseCategoryOptions_DuplicateNamesGetSuffix(t *testing.T) {
	categories := []*models.TransactionCategory{
		newTestCategory(10, 0, "Food & Drink", 1, false),
		newTestCategory(11, 10, "Food", 1, false),
		newTestCategory(12, 10, "Food", 2, false),
	}

	options := BuildExpenseCategoryOptions(categories)

	assert.Equal(t, []string{"Food & Drink > Food", "Food & Drink > Food (2)"}, options.Names)
	assert.Equal(t, int64(12), options.CategoryIds["Food & Drink > Food (2)"])
}

func TestBuildReceiptItemsQuestions(t *testing.T) {
	options := &ExpenseCategoryOptions{
		Names:       []string{"Food & Drink > Food", "Boat Spare Parts > Ropes"},
		CategoryIds: map[string]int64{"Food & Drink > Food": 11, "Boat Spare Parts > Ropes": 22},
	}
	request := &models.ReceiptItemsClassificationRequest{
		Store:    "CONAD",
		Currency: "EUR",
		Items: []*models.ReceiptItem{
			{Line: "BAGUETTE 250g", Detail: "1 PZ x 0.49 EUR/PZ", Price: "0.49"},
			{Line: "PATATE NOVELLE 1.5kg", Price: "3.29"},
		},
	}

	state, questions := BuildReceiptItemsQuestions(request, options)
	stateJson, _ := json.Marshal(state)
	questionsJson, _ := json.Marshal(questions)

	assert.JSONEq(t, `{"receipt":{"store":"CONAD","currency":"EUR","language":"product names as printed by the till, often abbreviated","items":[{"line":"BAGUETTE 250g","detail":"1 PZ x 0.49 EUR/PZ","price":"0.49"},{"line":"PATATE NOVELLE 1.5kg","price":"3.29"}]}}`, string(stateJson))
	assert.JSONEq(t, `{
		"item_0":{"type":"choice","instructions":"Which expense category does the purchased product `+"`receipt.items[0].line`"+` belong to?","criteria":{"Food & Drink > Food":null,"Boat Spare Parts > Ropes":null}},
		"item_1":{"type":"choice","instructions":"Which expense category does the purchased product `+"`receipt.items[1].line`"+` belong to?","criteria":{"Food & Drink > Food":null,"Boat Spare Parts > Ropes":null}}
	}`, string(questionsJson))
}

func TestParseReceiptItemsAnswers(t *testing.T) {
	options := &ExpenseCategoryOptions{
		Names:       []string{"A > Food", "A > Drink", "B > Ropes", "B > Tools"},
		CategoryIds: map[string]int64{"A > Food": 1, "A > Drink": 2, "B > Ropes": 3, "B > Tools": 4},
	}
	response := &SystemOneResponse{
		Answers: map[string]*SystemOneAnswer{
			"item_0": {Type: "choice", Choice: "A > Food", Confidence: 0.93, Probabilities: map[string]float64{"A > Food": 0.95, "A > Drink": 0.03, "B > Ropes": 0.01, "B > Tools": 0.01}},
			"item_1": {Type: "choice", Choice: "B > Ropes", Confidence: 0.4, Probabilities: map[string]float64{"A > Food": 0.05, "A > Drink": 0.05, "B > Ropes": 0.5, "B > Tools": 0.4}},
		},
	}

	results, err := ParseReceiptItemsAnswers(response, 2, options, 2)

	assert.Nil(t, err)
	assert.Equal(t, int64(1), results[0].CategoryId)
	assert.Equal(t, 0.93, results[0].Confidence)
	assert.Equal(t, 2, len(results[0].Alternatives))
	assert.Equal(t, int64(1), results[0].Alternatives[0].CategoryId)
	assert.Equal(t, int64(2), results[0].Alternatives[1].CategoryId)
	assert.Equal(t, int64(3), results[1].CategoryId)
	assert.Equal(t, int64(4), results[1].Alternatives[1].CategoryId)
}

func TestParseReceiptItemsAnswers_MissingAnswer(t *testing.T) {
	options := &ExpenseCategoryOptions{Names: []string{"A > Food"}, CategoryIds: map[string]int64{"A > Food": 1}}
	response := &SystemOneResponse{Answers: map[string]*SystemOneAnswer{"item_0": {Choice: "A > Food"}}}

	_, err := ParseReceiptItemsAnswers(response, 2, options, 3)

	assert.NotNil(t, err)
}

func TestParseReceiptItemsAnswers_UnknownChoice(t *testing.T) {
	options := &ExpenseCategoryOptions{Names: []string{"A > Food"}, CategoryIds: map[string]int64{"A > Food": 1}}
	response := &SystemOneResponse{Answers: map[string]*SystemOneAnswer{"item_0": {Choice: "Something Else"}}}

	_, err := ParseReceiptItemsAnswers(response, 1, options, 3)

	assert.NotNil(t, err)
}
