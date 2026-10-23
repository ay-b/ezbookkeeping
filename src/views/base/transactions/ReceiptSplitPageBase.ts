import { ref, computed } from 'vue';

import { useI18n } from '@/locales/helpers.ts';

import { useSettingsStore } from '@/stores/setting.ts';
import { useUserStore } from '@/stores/user.ts';
import { useAccountsStore } from '@/stores/account.ts';
import { useTransactionCategoriesStore } from '@/stores/transactionCategory.ts';
import { useTransactionTemplatesStore } from '@/stores/transactionTemplate.ts';
import { useTransactionsStore } from '@/stores/transaction.ts';
import { useExchangeRatesStore } from '@/stores/exchangeRates.ts';

import { CategoryType } from '@/core/category.ts';
import { TransactionType } from '@/core/transaction.ts';
import { TemplateType } from '@/core/template.ts';
import { AMOUNT_FACTOR } from '@/consts/numeral.ts';

import type { Account } from '@/models/account.ts';
import { Transaction } from '@/models/transaction.ts';
import type { TransactionTemplate } from '@/models/transaction_template.ts';
import type { ReceiptItemCategoryProbabilityResponse } from '@/models/receipt_item.ts';

import { isNumber } from '@/lib/common.ts';
import { getCurrentUnixTime, getTimezoneOffsetMinutes } from '@/lib/datetime.ts';
import { generateRandomUUID } from '@/lib/misc.ts';
import { parseBigDecimal } from '@/lib/numeral.ts';
import {
    type ParsedReceiptItem,
    type ReceiptItemGroup,
    parseReceiptText,
    getReceiptItemsTotalAmount,
    groupReceiptItemsByCategory,
    buildReceiptItemsComment
} from '@/lib/receipt.ts';
import { getAmountConvertedByTemplate, getTemplateConversionNoteLine } from '@/lib/template.ts';
import services from '@/lib/services.ts';
import logger from '@/lib/logger.ts';

export interface ReceiptReviewItem extends ParsedReceiptItem {
    id: string;
    categoryId: string;
    confidence?: number;
    alternatives: ReceiptItemCategoryProbabilityResponse[];
}

export interface ReceiptExpenseCategoryOption {
    id: string;
    name: string;
    primaryName: string;
}

export interface ReceiptTransactionGroup extends ReceiptItemGroup<ReceiptReviewItem> {
    categoryName: string;
    accountAmount: number | null; // the amount in account currency, null when the exchange rate is not available
}

// items with a lower classification confidence are highlighted for review
export const RECEIPT_ITEM_LOW_CONFIDENCE = 0.6;

export function useReceiptSplitPageBase() {
    const { tt, formatAmountToLocalizedNumeralsWithCurrency } = useI18n();

    const settingsStore = useSettingsStore();
    const userStore = useUserStore();
    const accountsStore = useAccountsStore();
    const transactionCategoriesStore = useTransactionCategoriesStore();
    const transactionTemplatesStore = useTransactionTemplatesStore();
    const transactionsStore = useTransactionsStore();
    const exchangeRatesStore = useExchangeRatesStore();

    const receiptText = ref<string>('');
    const store = ref<string>('');
    const items = ref<ReceiptReviewItem[]>([]);
    const receiptTotal = ref<number | undefined>(undefined);
    const hasUnpairedLines = ref<boolean>(false);
    const accountId = ref<string>('');
    const transactionTime = ref<number>(getCurrentUnixTime());
    const conversionTemplateId = ref<string>('');
    const classificationFailed = ref<boolean>(false);
    const classifying = ref<boolean>(false);
    const submitting = ref<boolean>(false);
    const clientSessionId = ref<string>(generateRandomUUID());

    const allVisibleAccounts = computed<Account[]>(() => accountsStore.allVisiblePlainAccounts);

    const allExpenseCategories = computed<ReceiptExpenseCategoryOption[]>(() => {
        const options: ReceiptExpenseCategoryOption[] = [];

        for (const primaryCategory of transactionCategoriesStore.allTransactionCategories[CategoryType.Expense] || []) {
            if (!primaryCategory.visible || !primaryCategory.subCategories) {
                continue;
            }

            for (const category of primaryCategory.subCategories) {
                if (category.visible) {
                    options.push({ id: category.id, name: category.name, primaryName: primaryCategory.name });
                }
            }
        }

        return options;
    });

    const allExpenseCategoriesMap = computed<Record<string, ReceiptExpenseCategoryOption>>(() => {
        const map: Record<string, ReceiptExpenseCategoryOption> = {};

        for (const category of allExpenseCategories.value) {
            map[category.id] = category;
        }

        return map;
    });

    const allConversionTemplates = computed<TransactionTemplate[]>(() => {
        const templates = transactionTemplatesStore.allTransactionTemplates[TemplateType.Normal.type] || [];
        return templates.filter(template => !template.hidden && template.enableConversion && !!template.sourceCurrency);
    });

    const conversionTemplate = computed<TransactionTemplate | null>(() => allConversionTemplates.value.find(template => template.id === conversionTemplateId.value) || null);

    const accountCurrency = computed<string>(() => accountsStore.allAccountsMap[accountId.value]?.currency || userStore.currentUserDefaultCurrency);

    // the currency printed on the receipt: the template currency when a conversion template is selected, otherwise the account currency
    const receiptCurrency = computed<string>(() => conversionTemplate.value?.sourceCurrency || accountCurrency.value);

    const isConversionApplied = computed<boolean>(() => receiptCurrency.value !== accountCurrency.value);

    const itemsTotal = computed<number>(() => getReceiptItemsTotalAmount(items.value));

    const isTotalMatched = computed<boolean>(() => !isNumber(receiptTotal.value) || receiptTotal.value === itemsTotal.value);

    const groups = computed<ReceiptTransactionGroup[]>(() => {
        return groupReceiptItemsByCategory(items.value.filter(item => !!item.categoryId)).map(group => {
            const category = allExpenseCategoriesMap.value[group.categoryId];

            return {
                ...group,
                categoryName: category ? `${category.primaryName} > ${category.name}` : '',
                accountAmount: getAmountConvertedByTemplate(group.amount, receiptCurrency.value, accountCurrency.value, conversionTemplate.value?.conversionCommission || 0, exchangeRatesStore.getExchangedAmount)
            };
        });
    });

    const accountTotal = computed<number | null>(() => {
        let total = 0;

        for (const group of groups.value) {
            if (!isNumber(group.accountAmount)) {
                return null;
            }

            total += group.accountAmount;
        }

        return total;
    });

    const inputProblemMessage = computed<string | null>(() => {
        if (!items.value.length) {
            return 'There are no receipt items';
        } else if (items.value.some(item => !item.line.trim())) {
            return 'Some receipt items have no name';
        } else if (items.value.some(item => !item.categoryId)) {
            return 'Some receipt items have no category';
        } else if (!accountId.value) {
            return 'Account cannot be blank';
        } else if (groups.value.some(group => group.amount <= 0)) {
            return 'The amount of each category must be greater than zero';
        } else if (!isNumber(accountTotal.value)) {
            return 'Failed to convert currency. Please check exchange rates';
        }

        return null;
    });

    function formatAmount(amount: number, currency: string): string {
        return formatAmountToLocalizedNumeralsWithCurrency(parseBigDecimal(amount), currency);
    }

    function getCategoryDisplayName(categoryId: string): string {
        const category = allExpenseCategoriesMap.value[categoryId];
        return category ? `${category.primaryName} › ${category.name}` : tt('None');
    }

    function loadEssentialData(): Promise<unknown> {
        return Promise.all([
            accountsStore.loadAllAccounts({ force: false }),
            transactionCategoriesStore.loadAllCategories({ force: false }),
            transactionTemplatesStore.loadAllTemplates({ templateType: TemplateType.Normal.type, force: false })
        ]).then(() => {
            if (!accountId.value || !accountsStore.allAccountsMap[accountId.value]) {
                const defaultAccountId = userStore.currentUserDefaultAccountId;
                const defaultAccount = defaultAccountId ? allVisibleAccounts.value.find(account => account.id === defaultAccountId) : undefined;
                accountId.value = defaultAccount?.id || allVisibleAccounts.value[0]?.id || '';
            }
        });
    }

    function selectConversionTemplate(templateId: string): void {
        conversionTemplateId.value = templateId;

        if (conversionTemplate.value?.sourceAccountId && accountsStore.allAccountsMap[conversionTemplate.value.sourceAccountId]) {
            accountId.value = conversionTemplate.value.sourceAccountId;
        }
    }

    function addItem(): void {
        items.value.push({ id: generateRandomUUID(), line: '', amount: 0, paired: true, categoryId: '', alternatives: [] });
    }

    function removeItem(item: ReceiptReviewItem): void {
        items.value = items.value.filter(existingItem => existingItem.id !== item.id);
    }

    function updateItemAmount(item: ReceiptReviewItem, amount: number): void {
        item.amount = amount;
        item.paired = true;
    }

    // parses the receipt text into items and classifies the categories of all items by TypeSafe in one request
    function parseAndClassify(): Promise<void> {
        const parsedReceipt = parseReceiptText(receiptText.value);

        items.value = parsedReceipt.items.map(item => ({ ...item, id: generateRandomUUID(), categoryId: '', alternatives: [] }));
        receiptTotal.value = parsedReceipt.total;
        hasUnpairedLines.value = parsedReceipt.hasUnpairedLines;
        classificationFailed.value = false;
        clientSessionId.value = generateRandomUUID();

        const itemsToClassify = items.value.filter(item => !!item.line.trim());

        if (!itemsToClassify.length) {
            return Promise.resolve();
        }

        classifying.value = true;

        return services.classifyReceiptItems({
            store: store.value.trim() || undefined,
            currency: receiptCurrency.value,
            items: itemsToClassify.map(item => ({
                line: item.line,
                detail: item.detail,
                price: (item.amount / AMOUNT_FACTOR).toFixed(2)
            }))
        }).then(response => {
            classifying.value = false;
            const results = response.data?.result?.items;

            if (!response.data?.success || !results || results.length !== itemsToClassify.length) {
                classificationFailed.value = true;
                return;
            }

            for (let i = 0; i < itemsToClassify.length; i++) {
                const item = itemsToClassify[i] as ReceiptReviewItem;
                const result = results[i];

                if (result && allExpenseCategoriesMap.value[result.categoryId]) {
                    item.categoryId = result.categoryId;
                    item.confidence = result.confidence;
                    item.alternatives = result.alternatives.filter(alternative => !!allExpenseCategoriesMap.value[alternative.categoryId]);
                }
            }
        }).catch(error => {
            classifying.value = false;
            classificationFailed.value = true;
            logger.error('failed to classify receipt items', error);
        });
    }

    function buildTransactions(): Transaction[] {
        const timezone = settingsStore.appSettings.timeZone;
        const utcOffset = getTimezoneOffsetMinutes(transactionTime.value, timezone);
        const transactions: Transaction[] = [];

        for (const group of groups.value) {
            const transaction = Transaction.createNewTransaction(TransactionType.Expense, transactionTime.value, timezone, utcOffset);
            const conversionNoteLine = isConversionApplied.value ? getTemplateConversionNoteLine(group.amount, receiptCurrency.value, accountCurrency.value) : undefined;

            transaction.sourceAccountId = accountId.value;
            transaction.setCategoryId(group.categoryId);
            transaction.sourceAmount = group.accountAmount as number;
            transaction.comment = buildReceiptItemsComment(group.items, conversionNoteLine);
            transactions.push(transaction);
        }

        return transactions;
    }

    // saves one expense transaction per category in one request
    function save(): Promise<number> {
        const transactions = buildTransactions();
        submitting.value = true;

        return services.importTransactions({
            transactions: transactions.map(transaction => transaction.toCreateRequest(clientSessionId.value)),
            clientSessionId: clientSessionId.value
        }).then(response => {
            submitting.value = false;

            if (!response.data?.success || !response.data.result) {
                throw { message: 'Unable to add transactions' };
            }

            transactionsStore.updateTransactionListInvalidState(true);
            return response.data.result.importedCount;
        }).catch(error => {
            submitting.value = false;
            transactionsStore.updateTransactionListInvalidState(true);
            throw error;
        });
    }

    function reset(): void {
        receiptText.value = '';
        store.value = '';
        items.value = [];
        receiptTotal.value = undefined;
        hasUnpairedLines.value = false;
        conversionTemplateId.value = '';
        transactionTime.value = getCurrentUnixTime();
        classificationFailed.value = false;
        clientSessionId.value = generateRandomUUID();
    }

    return {
        // states
        receiptText,
        store,
        items,
        receiptTotal,
        hasUnpairedLines,
        accountId,
        transactionTime,
        conversionTemplateId,
        classificationFailed,
        classifying,
        submitting,
        // computed states
        allVisibleAccounts,
        allExpenseCategories,
        allExpenseCategoriesMap,
        allConversionTemplates,
        conversionTemplate,
        accountCurrency,
        receiptCurrency,
        isConversionApplied,
        itemsTotal,
        isTotalMatched,
        groups,
        accountTotal,
        inputProblemMessage,
        // functions
        formatAmount,
        getCategoryDisplayName,
        loadEssentialData,
        selectConversionTemplate,
        addItem,
        removeItem,
        updateItemAmount,
        parseAndClassify,
        save,
        reset
    };
}
