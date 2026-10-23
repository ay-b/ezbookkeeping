<template>
    <v-dialog width="1100" :persistent="!!receiptText || classifying || submitting" v-model="showState">
        <one-column-dialog-layout content-style="height: 640px"
                                  :disabled="loading || classifying || submitting"
                                  :loading="loading || classifying || submitting"
                                  :title="tt('Split Receipt by Category')"
                                  :cancel-button-title="tt('Cancel')"
                                  @cancel="cancel">
            <template #toolbar>
                <v-btn class="mx-2" density="comfortable" variant="outlined"
                       :disabled="loading || classifying || !receiptText.trim()"
                       @click="classify" v-if="step === 'input'">{{ tt('Classify') }}</v-btn>
                <v-btn class="mx-2" density="comfortable" variant="outlined"
                       :disabled="classifying || submitting"
                       @click="step = 'input'" v-if="step === 'review'">{{ tt('Edit Receipt Text') }}</v-btn>
            </template>

            <template #content>
                <div v-if="step === 'input'">
                    <v-text-field type="text" persistent-placeholder class="mb-4"
                                  :disabled="loading || classifying"
                                  :label="tt('Store')"
                                  :placeholder="tt('Store name (optional), helps to classify the items')"
                                  v-model="store" />
                    <v-textarea persistent-placeholder rows="16" class="receipt-split-text"
                                :disabled="loading || classifying"
                                :label="tt('Receipt Text')"
                                :placeholder="tt('Paste the text of the receipt, e.g. recognized from a photo')"
                                v-model="receiptText" />
                    <div class="text-body-small text-medium-emphasis mt-2">{{ tt('Item names are sent to TypeSafe to classify their categories.') }}</div>
                </div>

                <div v-if="step === 'review'">
                    <v-row>
                        <v-col cols="12" md="4">
                            <v-autocomplete item-title="name" item-value="id" persistent-placeholder
                                            :disabled="submitting"
                                            :label="tt('Account')"
                                            :items="allVisibleAccounts"
                                            v-model="accountId" />
                        </v-col>
                        <v-col cols="12" md="4">
                            <date-time-select :disabled="submitting"
                                              :label="tt('Transaction Time')"
                                              :timezone-utc-offset="transactionUtcOffset"
                                              v-model="transactionTime" />
                        </v-col>
                        <v-col cols="12" md="4">
                            <v-select item-title="name" item-value="id" persistent-placeholder
                                      :disabled="submitting"
                                      :label="tt('Currency Conversion')"
                                      :items="conversionTemplateOptions"
                                      :model-value="conversionTemplateId"
                                      @update:model-value="selectConversionTemplate($event as string)" />
                        </v-col>
                    </v-row>

                    <v-alert class="mb-3" type="error" variant="tonal" density="compact" v-if="classificationFailed">
                        {{ tt('Unable to classify the receipt items, please choose the categories manually') }}
                    </v-alert>
                    <v-alert class="mb-3" type="warning" variant="tonal" density="compact" v-if="hasUnpairedLines">
                        {{ tt('Some lines could not be matched with a price, please check the highlighted items') }}
                    </v-alert>

                    <v-table density="compact" class="receipt-split-items-table">
                        <thead>
                        <tr>
                            <th>{{ tt('Item') }}</th>
                            <th style="width: 170px">{{ tt('Amount') }}</th>
                            <th style="width: 340px">{{ tt('Category') }}</th>
                            <th style="width: 48px"></th>
                        </tr>
                        </thead>
                        <tbody>
                        <tr :class="{ 'receipt-split-item-unpaired': !item.paired }" :key="item.id" v-for="item in items">
                            <td>
                                <v-text-field density="compact" variant="plain" hide-details="auto"
                                              :disabled="submitting"
                                              :placeholder="tt('Item name')"
                                              :hint="item.detail" :persistent-hint="!!item.detail"
                                              v-model="item.line" />
                            </td>
                            <td>
                                <amount-input density="compact" variant="plain"
                                              :disabled="submitting"
                                              :currency="receiptCurrency"
                                              :show-currency="true"
                                              :model-value="item.amount"
                                              @update:model-value="updateItemAmount(item, $event)" />
                            </td>
                            <td>
                                <div class="d-flex align-center">
                                    <v-autocomplete density="compact" variant="plain" hide-details
                                                    item-title="title" item-value="id"
                                                    :disabled="submitting"
                                                    :placeholder="tt('Category')"
                                                    :items="categoryOptions"
                                                    v-model="item.categoryId" />
                                    <v-chip size="x-small" class="ms-2" label
                                            :color="item.confidence < RECEIPT_ITEM_LOW_CONFIDENCE ? 'warning' : 'default'"
                                            v-if="isNumber(item.confidence) && item.categoryId">
                                        {{ formatPercent(item.confidence) }}
                                        <v-tooltip activator="parent" v-if="item.alternatives.length > 1">
                                            <div :key="alternative.categoryId" v-for="alternative in item.alternatives">
                                                {{ getCategoryDisplayName(alternative.categoryId) }}: {{ formatPercent(alternative.probability) }}
                                            </div>
                                        </v-tooltip>
                                    </v-chip>
                                </div>
                            </td>
                            <td>
                                <v-btn density="comfortable" variant="text" size="small" color="default"
                                       :disabled="submitting" :icon="mdiDeleteOutline"
                                       @click="removeItem(item)" />
                            </td>
                        </tr>
                        </tbody>
                    </v-table>
                    <v-btn class="mt-2" size="small" variant="text" :prepend-icon="mdiPlus"
                           :disabled="submitting" @click="addItem">{{ tt('Add Item') }}</v-btn>

                    <v-divider class="my-3" />

                    <div class="text-title-small mb-2">{{ tt('Transactions to Add') }}</div>
                    <v-table density="compact">
                        <tbody>
                        <tr :key="group.categoryId" v-for="group in groups">
                            <td>{{ group.categoryName }}</td>
                            <td class="text-medium-emphasis">{{ tt('format.misc.receiptItemsCount', { count: group.items.length }) }}</td>
                            <td class="text-end">{{ formatAmount(group.amount, receiptCurrency) }}</td>
                            <td class="text-end font-weight-bold" v-if="isConversionApplied">
                                {{ isNumber(group.accountAmount) ? formatAmount(group.accountAmount, accountCurrency) : '-' }}
                            </td>
                        </tr>
                        <tr class="font-weight-bold">
                            <td>{{ tt('Total') }}</td>
                            <td></td>
                            <td class="text-end">{{ formatAmount(itemsTotal, receiptCurrency) }}</td>
                            <td class="text-end" v-if="isConversionApplied">
                                {{ isNumber(accountTotal) ? formatAmount(accountTotal, accountCurrency) : '-' }}
                            </td>
                        </tr>
                        </tbody>
                    </v-table>
                    <div class="mt-2" :class="isTotalMatched ? 'text-success' : 'text-error'" v-if="isNumber(receiptTotal)">
                        {{ tt('Receipt total') }}: {{ formatAmount(receiptTotal, receiptCurrency) }}
                        <span v-if="isTotalMatched">✓</span>
                        <span v-else>— {{ tt('difference') }} {{ formatAmount(itemsTotal - receiptTotal, receiptCurrency) }}</span>
                    </div>
                </div>
            </template>

            <template #footer v-if="step === 'review'">
                <div class="d-flex align-center gap-4">
                    <span class="text-body-medium text-error" v-if="inputProblemMessage">{{ tt(inputProblemMessage) }}</span>
                    <v-btn :disabled="!!inputProblemMessage || submitting" @click="submit">
                        {{ tt('format.misc.addTransactionsCount', { count: groups.length }) }}
                        <v-progress-circular indeterminate size="22" class="ms-2" v-if="submitting"></v-progress-circular>
                    </v-btn>
                </div>
            </template>
        </one-column-dialog-layout>
    </v-dialog>

    <snack-bar ref="snackbar" />
</template>

<script setup lang="ts">
import SnackBar from '@/components/desktop/SnackBar.vue';

import { ref, computed, useTemplateRef } from 'vue';

import { useI18n } from '@/locales/helpers.ts';
import { RECEIPT_ITEM_LOW_CONFIDENCE, useReceiptSplitPageBase } from '@/views/base/transactions/ReceiptSplitPageBase.ts';

import { useSettingsStore } from '@/stores/setting.ts';

import { isNumber } from '@/lib/common.ts';
import { getTimezoneOffsetMinutes } from '@/lib/datetime.ts';

import {
    mdiDeleteOutline,
    mdiPlus
} from '@mdi/js';

type SnackBarType = InstanceType<typeof SnackBar>;

const { tt } = useI18n();

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
    allExpenseCategories,
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
    save,
    reset
} = useReceiptSplitPageBase();

const settingsStore = useSettingsStore();

const snackbar = useTemplateRef<SnackBarType>('snackbar');

let resolveFunc: ((importedCount: number) => void) | null = null;
let rejectFunc: ((reason?: unknown) => void) | null = null;

const showState = ref<boolean>(false);
const loading = ref<boolean>(false);
const step = ref<'input' | 'review'>('input');

const transactionUtcOffset = computed<number>(() => getTimezoneOffsetMinutes(transactionTime.value, settingsStore.appSettings.timeZone));

const categoryOptions = computed<{ id: string, title: string }[]>(() => allExpenseCategories.value.map(category => ({
    id: category.id,
    title: `${category.primaryName} › ${category.name}`
})));

const conversionTemplateOptions = computed<{ id: string, name: string }[]>(() => [
    { id: '', name: tt('None') },
    ...allConversionTemplates.value.map(template => ({ id: template.id, name: `${template.name} (${template.sourceCurrency})` }))
]);

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function open(): Promise<number> {
    reset();
    step.value = 'input';
    showState.value = true;
    loading.value = true;

    loadEssentialData().then(() => {
        loading.value = false;
    }).catch(error => {
        loading.value = false;

        if (!error.processed) {
            snackbar.value?.showError(error);
        }
    });

    return new Promise((resolve, reject) => {
        resolveFunc = resolve;
        rejectFunc = reject;
    });
}

function classify(): void {
    parseAndClassify().then(() => {
        if (!items.value.length) {
            snackbar.value?.showMessage('No receipt items are found in the text');
            return;
        }

        step.value = 'review';
    });
}

function submit(): void {
    save().then(importedCount => {
        resolveFunc?.(importedCount);
        showState.value = false;
    }).catch(error => {
        if (error.error && error.error.context && isNumber(error.error.context.importedCount) && error.error.context.importedCount > 0) {
            snackbar.value?.showMessage('Only some of the transactions were added, please check the transaction list');
        } else if (!error.processed) {
            snackbar.value?.showError(error);
        }
    });
}

function cancel(): void {
    rejectFunc?.();
    showState.value = false;
}

defineExpose({
    open
});
</script>

<style>
.receipt-split-text textarea {
    font-family: monospace;
}

.receipt-split-items-table td {
    vertical-align: top;
    padding-top: 4px !important;
    padding-bottom: 4px !important;
}

.receipt-split-item-unpaired {
    background-color: rgba(var(--v-theme-warning), 0.12);
}
</style>
