export interface ReceiptItemsClassificationRequest {
    readonly store?: string;
    readonly currency?: string;
    readonly items: ReceiptItemClassificationRequestItem[];
}

export interface ReceiptItemClassificationRequestItem {
    readonly line: string;
    readonly detail?: string;
    readonly price?: string;
}

export interface ReceiptItemsClassificationResponse {
    readonly items: ReceiptItemClassificationResponse[];
}

export interface ReceiptItemClassificationResponse {
    readonly categoryId: string;
    readonly confidence: number;
    readonly alternatives: ReceiptItemCategoryProbabilityResponse[];
}

export interface ReceiptItemCategoryProbabilityResponse {
    readonly categoryId: string;
    readonly probability: number;
}
