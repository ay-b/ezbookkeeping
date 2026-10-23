package typesafe

import (
	"fmt"
	"sort"

	"github.com/mayswind/ezbookkeeping/pkg/models"
)

const receiptItemQuestionIdPrefix = "item_"

// ExpenseCategoryOptions represents the expense categories offered as the options of choice questions
type ExpenseCategoryOptions struct {
	Names       []string
	CategoryIds map[string]int64
}

// BuildExpenseCategoryOptions returns the visible secondary expense categories as options named "Primary > Secondary" in display order
func BuildExpenseCategoryOptions(categories []*models.TransactionCategory) *ExpenseCategoryOptions {
	primaryCategories := make(map[int64]*models.TransactionCategory)
	secondaryCategories := make([]*models.TransactionCategory, 0, len(categories))

	for i := 0; i < len(categories); i++ {
		category := categories[i]

		if category.Type != models.CATEGORY_TYPE_EXPENSE || category.Hidden {
			continue
		}

		if category.ParentCategoryId == models.LevelOneTransactionCategoryParentId {
			primaryCategories[category.CategoryId] = category
		} else {
			secondaryCategories = append(secondaryCategories, category)
		}
	}

	visibleSecondaryCategories := make([]*models.TransactionCategory, 0, len(secondaryCategories))

	for i := 0; i < len(secondaryCategories); i++ {
		if _, exists := primaryCategories[secondaryCategories[i].ParentCategoryId]; exists {
			visibleSecondaryCategories = append(visibleSecondaryCategories, secondaryCategories[i])
		}
	}

	sort.SliceStable(visibleSecondaryCategories, func(i, j int) bool {
		parent1 := primaryCategories[visibleSecondaryCategories[i].ParentCategoryId]
		parent2 := primaryCategories[visibleSecondaryCategories[j].ParentCategoryId]

		if parent1.DisplayOrder != parent2.DisplayOrder {
			return parent1.DisplayOrder < parent2.DisplayOrder
		}

		if parent1.CategoryId != parent2.CategoryId {
			return parent1.CategoryId < parent2.CategoryId
		}

		return visibleSecondaryCategories[i].DisplayOrder < visibleSecondaryCategories[j].DisplayOrder
	})

	options := &ExpenseCategoryOptions{
		Names:       make([]string, 0, len(visibleSecondaryCategories)),
		CategoryIds: make(map[string]int64, len(visibleSecondaryCategories)),
	}

	for i := 0; i < len(visibleSecondaryCategories); i++ {
		category := visibleSecondaryCategories[i]
		name := fmt.Sprintf("%s > %s", primaryCategories[category.ParentCategoryId].Name, category.Name)

		for suffix := 2; options.CategoryIds[name] != 0; suffix++ {
			name = fmt.Sprintf("%s > %s (%d)", primaryCategories[category.ParentCategoryId].Name, category.Name, suffix)
		}

		options.Names = append(options.Names, name)
		options.CategoryIds[name] = category.CategoryId
	}

	return options
}

// BuildReceiptItemsQuestions returns the state and the choice questions which ask the expense category of each receipt item
func BuildReceiptItemsQuestions(request *models.ReceiptItemsClassificationRequest, options *ExpenseCategoryOptions) (any, map[string]*SystemOneQuestion) {
	items := make([]map[string]string, len(request.Items))

	for i := 0; i < len(request.Items); i++ {
		item := map[string]string{
			"line": request.Items[i].Line,
		}

		if request.Items[i].Detail != "" {
			item["detail"] = request.Items[i].Detail
		}

		if request.Items[i].Price != "" {
			item["price"] = request.Items[i].Price
		}

		items[i] = item
	}

	receipt := map[string]any{
		"language": "product names as printed by the till, often abbreviated",
		"items":    items,
	}

	if request.Store != "" {
		receipt["store"] = request.Store
	}

	if request.Currency != "" {
		receipt["currency"] = request.Currency
	}

	criteria := make(map[string]*string, len(options.Names))

	for i := 0; i < len(options.Names); i++ {
		criteria[options.Names[i]] = nil
	}

	questions := make(map[string]*SystemOneQuestion, len(request.Items))

	for i := 0; i < len(request.Items); i++ {
		questions[fmt.Sprintf("%s%d", receiptItemQuestionIdPrefix, i)] = &SystemOneQuestion{
			Type:         SystemOneQuestionTypeChoice,
			Instructions: fmt.Sprintf("Which expense category does the purchased product `receipt.items[%d].line` belong to?", i),
			Criteria:     criteria,
		}
	}

	return map[string]any{"receipt": receipt}, questions
}

// ParseReceiptItemsAnswers returns the classification result of each receipt item from the answers, the alternatives contain at most the specified count of most probable categories
func ParseReceiptItemsAnswers(response *SystemOneResponse, itemCount int, options *ExpenseCategoryOptions, maxAlternatives int) ([]*models.ReceiptItemClassificationResponse, error) {
	results := make([]*models.ReceiptItemClassificationResponse, itemCount)

	for i := 0; i < itemCount; i++ {
		questionId := fmt.Sprintf("%s%d", receiptItemQuestionIdPrefix, i)
		answer := response.Answers[questionId]

		if answer == nil {
			return nil, fmt.Errorf("answer of question \"%s\" is missing", questionId)
		}

		categoryId, exists := options.CategoryIds[answer.Choice]

		if !exists {
			return nil, fmt.Errorf("choice \"%s\" of question \"%s\" is not a known option", answer.Choice, questionId)
		}

		alternatives := make([]*models.ReceiptItemCategoryProbabilityResponse, 0, len(answer.Probabilities))

		for name, probability := range answer.Probabilities {
			if alternativeCategoryId, exists := options.CategoryIds[name]; exists {
				alternatives = append(alternatives, &models.ReceiptItemCategoryProbabilityResponse{
					CategoryId:  alternativeCategoryId,
					Probability: probability,
				})
			}
		}

		sort.Slice(alternatives, func(i, j int) bool {
			if alternatives[i].Probability != alternatives[j].Probability {
				return alternatives[i].Probability > alternatives[j].Probability
			}

			return alternatives[i].CategoryId < alternatives[j].CategoryId
		})

		if len(alternatives) > maxAlternatives {
			alternatives = alternatives[:maxAlternatives]
		}

		results[i] = &models.ReceiptItemClassificationResponse{
			CategoryId:   categoryId,
			Confidence:   answer.Confidence,
			Alternatives: alternatives,
		}
	}

	return results, nil
}
