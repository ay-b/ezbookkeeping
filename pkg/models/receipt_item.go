package models

// ReceiptItemsClassificationRequest represents the request of classifying receipt items into expense categories
type ReceiptItemsClassificationRequest struct {
	Store    string         `json:"store" binding:"max=255"`
	Currency string         `json:"currency" binding:"omitempty,len=3"`
	Items    []*ReceiptItem `json:"items" binding:"required,dive"`
}

// ReceiptItem represents an item line of a receipt
type ReceiptItem struct {
	Line   string `json:"line" binding:"required,notBlank,max=255"`
	Detail string `json:"detail" binding:"max=255"`
	Price  string `json:"price" binding:"max=32"`
}

// ReceiptItemsClassificationResponse represents a view-object of receipt items classification response
type ReceiptItemsClassificationResponse struct {
	Items []*ReceiptItemClassificationResponse `json:"items"`
}

// ReceiptItemClassificationResponse represents a view-object of the classification result of a receipt item
type ReceiptItemClassificationResponse struct {
	CategoryId   int64                                     `json:"categoryId,string"`
	Confidence   float64                                   `json:"confidence"`
	Alternatives []*ReceiptItemCategoryProbabilityResponse `json:"alternatives"`
}

// ReceiptItemCategoryProbabilityResponse represents a view-object of the probability of a category for a receipt item
type ReceiptItemCategoryProbabilityResponse struct {
	CategoryId  int64   `json:"categoryId,string"`
	Probability float64 `json:"probability"`
}
