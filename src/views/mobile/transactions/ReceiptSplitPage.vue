<template>
    <f7-page @page:afterin="onPageAfterIn">
        <f7-navbar>
            <f7-nav-left :back-link="tt('Back')"></f7-nav-left>
            <f7-nav-title :title="tt('Split Receipt by Category')"></f7-nav-title>
            <f7-nav-right>
                <f7-link :class="{ 'disabled': loading || classifying || !receiptText.trim() }"
                         :text="tt('Classify')" @click="classify" v-if="step === 'input'"></f7-link>
                <f7-link :class="{ 'disabled': submitting }"
                         :text="tt('Edit Receipt Text')" @click="step = 'input'" v-if="step === 'review'"></f7-link>
            </f7-nav-right>
        </f7-navbar>

        <template v-if="step === 'input'">
            <f7-list form strong inset dividers class="margin-vertical">
                <f7-list-input type="text" clear-button
                               :disabled="loading || classifying"
                               :label="tt('Store')"
                               :placeholder="tt('Store name (optional), helps to classify the items')"
                               v-model:value="store"></f7-list-input>
                <f7-list-input type="textarea" class="receipt-split-text" resizable
                               :disabled="loading || classifying"
                               :label="tt('Receipt Text')"
                               :placeholder="tt('Paste the text of the receipt, e.g. recognized from a photo')"
                               v-model:value="receiptText"></f7-list-input>
            </f7-list>
            <f7-block-footer>{{ tt('Item names are sent to TypeSafe to classify their categories.') }}</f7-block-footer>
            <f7-block>
                <f7-button large fill :class="{ 'disabled': loading || classifying || !receiptText.trim() }" @click="classify">
                    <span>{{ tt('Classify') }}</span>
                    <f7-preloader class="margin-left-half" :size="20" color="white" v-if="classifying"></f7-preloader>
                </f7-button>
            </f7-block>
        </template>

        <template v-if="step === 'review'">
            <f7-list strong inset dividers class="margin-vertical">
                <f7-list-item link="#" no-chevron class="list-item-with-header-and-title"
                              :header="tt('Account')"
                              :title="selectedAccountName"
                              @click="showAccountSheet = true">
                    <list-item-selection-sheet value-type="item" key-field="id" value-field="id" title-field="name"
                                               :items="allVisibleAccounts"
                                               v-model:show="showAccountSheet"
                                               v-model="accountId">
                    </list-item-selection-sheet>
                </f7-list-item>
                <f7-list-item link="#" no-chevron class="list-item-with-header-and-title"
                              :header="tt('Transaction Time')"
                              :title="transactionDisplayDateTime"
                              @click="showDateTimeSheet = true">
                    <date-time-selection-sheet :timezone-utc-offset="transactionUtcOffset"
                                               v-model:show="showDateTimeSheet"
                                               v-model="transactionTime">
                    </date-time-selection-sheet>
                </f7-list-item>
                <f7-list-item link="#" no-chevron class="list-item-with-header-and-title"
                              :header="tt('Currency Conversion')"
                              :title="selectedConversionTemplateName"
                              @click="showConversionTemplateSheet = true">
                    <list-item-selection-sheet value-type="item" key-field="id" value-field="id" title-field="name"
                                               :items="conversionTemplateOptions"
                                               v-model:show="showConversionTemplateSheet"
                                               :model-value="conversionTemplateId"
                                               @update:model-value="selectConversionTemplate($event as string)">
                    </list-item-selection-sheet>
                </f7-list-item>
            </f7-list>

            <f7-block-footer class="text-color-red" v-if="classificationFailed">
                {{ tt('Unable to classify the receipt items, please choose the categories manually') }}
            </f7-block-footer>
            <f7-block-footer class="text-color-orange" v-if="hasUnpairedLines">
                {{ tt('Some lines could not be matched with a price, please check the highlighted items') }}
            </f7-block-footer>

            <f7-block-title>{{ tt('Items') }}</f7-block-title>
            <f7-list strong inset dividers class="margin-vertical-half"
                     :class="{ 'receipt-split-item-unpaired': !item.paired }"
                     :key="item.id" v-for="item in items">
                <f7-list-input type="text" clear-button
                               :placeholder="tt('Item name')"
                               :info="item.detail"
                               v-model:value="item.line"></f7-list-input>
                <f7-list-item link="#" no-chevron
                              :title="tt('Amount')"
                              :after="formatAmount(item.amount, receiptCurrency)"
                              @click="editItemAmount(item)"></f7-list-item>
                <f7-list-item link="#" no-chevron class="list-item-with-header-and-title"
                              :header="tt('Category')"
                              :footer="getItemConfidenceText(item)"
                              :class="{ 'receipt-split-item-low-confidence': isLowConfidence(item) }"
                              @click="editItemCategory(item)">
                    <template #title>
                        <span>{{ getCategoryDisplayName(item.categoryId) }}</span>
                    </template>
                </f7-list-item>
                <f7-list-button color="red" :text="tt('Delete')" @click="removeItem(item)"></f7-list-button>
            </f7-list>
            <f7-block class="margin-vertical-half">
                <f7-button small :text="tt('Add Item')" @click="addItem"></f7-button>
            </f7-block>

            <f7-block-title>{{ tt('Transactions to Add') }}</f7-block-title>
            <f7-list strong inset dividers class="margin-vertical-half">
                <f7-list-item :key="group.categoryId"
                              :title="group.categoryName"
                              :footer="isConversionApplied ? formatAmount(group.amount, receiptCurrency) : tt('format.misc.receiptItemsCount', { count: group.items.length })"
                              :after="isConversionApplied ? (isNumber(group.accountAmount) ? formatAmount(group.accountAmount, accountCurrency) : '-') : formatAmount(group.amount, receiptCurrency)"
                              v-for="group in groups"></f7-list-item>
                <f7-list-item class="receipt-split-total"
                              :title="tt('Total')"
                              :footer="isConversionApplied ? formatAmount(itemsTotal, receiptCurrency) : ''"
                              :after="isConversionApplied ? (isNumber(accountTotal) ? formatAmount(accountTotal, accountCurrency) : '-') : formatAmount(itemsTotal, receiptCurrency)"></f7-list-item>
            </f7-list>
            <f7-block-footer :class="isTotalMatched ? 'text-color-green' : 'text-color-red'" v-if="isNumber(receiptTotal)">
                {{ tt('Receipt total') }}: {{ formatAmount(receiptTotal, receiptCurrency) }}
                <span v-if="isTotalMatched">✓</span>
                <span v-else>— {{ tt('difference') }} {{ formatAmount(itemsTotal - receiptTotal, receiptCurrency) }}</span>
            </f7-block-footer>

            <f7-block>
                <f7-button large fill :class="{ 'disabled': !!inputProblemMessage || submitting }" @click="submit">
                    {{ tt('format.misc.addTransactionsCount', { count: groups.length }) }}
                </f7-button>
                <div class="text-color-red margin-top-half text-align-center" v-if="inputProblemMessage">{{ tt(inputProblemMessage) }}</div>
            </f7-block>

            <number-pad-sheet :min-value="TRANSACTION_MIN_AMOUNT"
                              :max-value="TRANSACTION_MAX_AMOUNT"
                              :currency="receiptCurrency"
                              v-model:show="showAmountSheet"
                              v-model="editingItemAmount">
            </number-pad-sheet>
            <tree-view-selection-sheet primary-key-field="id" primary-title-field="name"
                                       primary-icon-field="icon" primary-icon-type-field="iconType" primary-icon-type="category" primary-color-field="color"
                                       primary-hidden-field="hidden" primary-sub-items-field="subCategories"
                                       secondary-key-field="id" secondary-value-field="id" secondary-title-field="name"
                                       secondary-icon-field="icon" secondary-icon-type-field="iconType" secondary-icon-type="category" secondary-color-field="color"
                                       secondary-hidden-field="hidden"
                                       :enable-filter="true" :filter-placeholder="tt('Find category')" :filter-no-items-text="tt('No available category')"
                                       :items="allExpensePrimaryCategories"
                                       v-model:show="showCategorySheet"
                                       v-model="editingItemCategoryId">
            </tree-view-selection-sheet>
        </template>
    </f7-page>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Router } from 'framework7/types';

import { useI18n } from '@/locales/helpers.ts';
import { useI18nUIComponents, showLoading, hideLoading } from '@/lib/ui/mobile.ts';
import { RECEIPT_ITEM_LOW_CONFIDENCE, type ReceiptReviewItem, useReceiptSplitPageBase } from '@/views/base/transactions/ReceiptSplitPageBase.ts';

import { useSettingsStore } from '@/stores/setting.ts';
import { useAccountsStore } from '@/stores/account.ts';
import { useTransactionCategoriesStore } from '@/stores/transactionCategory.ts';

import { CategoryType } from '@/core/category.ts';
import { TRANSACTION_MIN_AMOUNT, TRANSACTION_MAX_AMOUNT } from '@/consts/transaction.ts';

import type { TransactionCategory } from '@/models/transaction_category.ts';

import { isNumber } from '@/lib/common.ts';
import { getTimezoneOffsetMinutes, parseDateTimeFromUnixTimeWithTimezoneOffset } from '@/lib/datetime.ts';

const props = defineProps<{
    f7router?: Router.Router;
}>();

const { tt, formatDateTimeToLongDateTime } = useI18n();
const { showToast } = useI18nUIComponents();

const {
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
    allVisibleAccounts,
    allConversionTemplates,
    accountCurrency,
    receiptCurrency,
    isConversionApplied,
    itemsTotal,
    isTotalMatched,
    groups,
    accountTotal,
    inputProblemMessage,
    formatAmount,
    getCategoryDisplayName,
    loadEssentialData,
    selectConversionTemplate,
    addItem,
    removeItem,
    updateItemAmount,
    parseAndClassify,
    save
} = useReceiptSplitPageBase();

const settingsStore = useSettingsStore();
const accountsStore = useAccountsStore();
const transactionCategoriesStore = useTransactionCategoriesStore();

const loading = ref<boolean>(true);
const loaded = ref<boolean>(false);
const step = ref<'input' | 'review'>('input');
const showAccountSheet = ref<boolean>(false);
const showDateTimeSheet = ref<boolean>(false);
const showConversionTemplateSheet = ref<boolean>(false);
const showAmountSheet = ref<boolean>(false);
const showCategorySheet = ref<boolean>(false);
const editingItem = ref<ReceiptReviewItem | null>(null);

const allExpensePrimaryCategories = computed<TransactionCategory[]>(() => transactionCategoriesStore.allTransactionCategories[CategoryType.Expense] || []);

const transactionUtcOffset = computed<number>(() => getTimezoneOffsetMinutes(transactionTime.value, settingsStore.appSettings.timeZone));

const transactionDisplayDateTime = computed<string>(() => formatDateTimeToLongDateTime(parseDateTimeFromUnixTimeWithTimezoneOffset(transactionTime.value, transactionUtcOffset.value)));

const selectedAccountName = computed<string>(() => accountsStore.allAccountsMap[accountId.value]?.name || tt('None'));

const conversionTemplateOptions = computed<{ id: string, name: string }[]>(() => [
    { id: '', name: tt('None') },
    ...allConversionTemplates.value.map(template => ({ id: template.id, name: `${template.name} (${template.sourceCurrency})` }))
]);

const selectedConversionTemplateName = computed<string>(() => conversionTemplateOptions.value.find(option => option.id === conversionTemplateId.value)?.name || tt('None'));

const editingItemAmount = computed<number>({
    get: () => editingItem.value?.amount || 0,
    set: (value: number) => {
        if (editingItem.value) {
            updateItemAmount(editingItem.value, value);
        }
    }
});

const editingItemCategoryId = computed<string>({
    get: () => editingItem.value?.categoryId || '',
    set: (value: string) => {
        if (editingItem.value) {
            editingItem.value.categoryId = value;
            editingItem.value.confidence = undefined;
        }
    }
});

function isLowConfidence(item: ReceiptReviewItem): boolean {
    return isNumber(item.confidence) && item.confidence < RECEIPT_ITEM_LOW_CONFIDENCE;
}

function getItemConfidenceText(item: ReceiptReviewItem): string {
    if (!isNumber(item.confidence) || !item.categoryId) {
        return '';
    }

    const alternatives = item.alternatives
        .filter(alternative => alternative.categoryId !== item.categoryId)
        .slice(0, 2)
        .map(alternative => `${getCategoryDisplayName(alternative.categoryId)} ${Math.round(alternative.probability * 100)}%`);

    return `${Math.round(item.confidence * 100)}%` + (isLowConfidence(item) && alternatives.length ? ` · ${alternatives.join(', ')}` : '');
}

function editItemAmount(item: ReceiptReviewItem): void {
    editingItem.value = item;
    showAmountSheet.value = true;
}

function editItemCategory(item: ReceiptReviewItem): void {
    editingItem.value = item;
    showCategorySheet.value = true;
}

function classify(): void {
    if (loading.value || classifying.value || !receiptText.value.trim()) {
        return;
    }

    showLoading(() => classifying.value);

    parseAndClassify().then(() => {
        hideLoading();

        if (!items.value.length) {
            showToast('No receipt items are found in the text');
            return;
        }

        step.value = 'review';
    });
}

function submit(): void {
    if (inputProblemMessage.value || submitting.value) {
        return;
    }

    showLoading(() => submitting.value);

    save().then(importedCount => {
        hideLoading();
        showToast(tt('format.misc.youHaveAddedTransactionsCount', { count: importedCount }));
        props.f7router?.back();
    }).catch(error => {
        hideLoading();

        if (error.error && error.error.context && isNumber(error.error.context.importedCount) && error.error.context.importedCount > 0) {
            showToast('Only some of the transactions were added, please check the transaction list');
        } else if (!error.processed) {
            showToast(error.message || error);
        }
    });
}

function onPageAfterIn(): void {
    if (loaded.value) {
        return;
    }

    loadEssentialData().then(() => {
        loading.value = false;
        loaded.value = true;
    }).catch(error => {
        loading.value = false;

        if (!error.processed) {
            showToast(error.message || error);
        }
    });
}
</script>

<style>
.receipt-split-text textarea {
    font-family: monospace;
    min-height: 280px;
}

.receipt-split-item-unpaired {
    --f7-list-strong-bg-color: rgba(255, 149, 0, 0.12);
}

.receipt-split-item-low-confidence .item-footer {
    color: var(--f7-color-orange);
}

.receipt-split-total .item-title,
.receipt-split-total .item-after {
    font-weight: bold;
}
</style>
