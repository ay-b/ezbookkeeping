import { reversed } from '@/core/base.ts';
import { AMOUNT_FACTOR, MAX_SUPPORTED_DECIMAL_NUMBER_COUNT } from '@/consts/numeral.ts';
import { TransactionTemplate } from '@/models/transaction_template.ts';
import { getCurrencyFraction } from '@/lib/currency.ts';

export function getTemplateConversionNoteLine(templateCurrencyAmount: number, templateCurrency: string, accountCurrency: string): string {
    const fraction = getCurrencyFraction(templateCurrency) ?? MAX_SUPPORTED_DECIMAL_NUMBER_COUNT;
    const amount = (templateCurrencyAmount / AMOUNT_FACTOR).toFixed(Math.min(fraction, MAX_SUPPORTED_DECIMAL_NUMBER_COUNT));
    return `${templateCurrency}${amount} converted to ${accountCurrency} with template`;
}

export function appendTemplateConversionNoteLine(comment: string, noteLine: string): string {
    const existingComment = comment.trimEnd();
    return existingComment ? `${existingComment}\n\n${noteLine}` : noteLine;
}

export function isNoAvailableTemplate(templates: TransactionTemplate[], showHidden: boolean): boolean {
    for (const template of templates) {
        if (showHidden || !template.hidden) {
            return false;
        }
    }

    return true;
}

export function getAvailableTemplateCount(templates: TransactionTemplate[], showHidden: boolean): number {
    let count = 0;

    for (const template of templates) {
        if (showHidden || !template.hidden) {
            count++;
        }
    }

    return count;
}

export function getFirstShowingId(templates: TransactionTemplate[], showHidden: boolean): string | null {
    for (const template of templates) {
        if (showHidden || !template.hidden) {
            return template.id;
        }
    }

    return null;
}

export function getLastShowingId(templates: TransactionTemplate[], showHidden: boolean): string | null {
    for (const template of reversed(templates)) {
        if (showHidden || !template.hidden) {
            return template.id;
        }
    }

    return null;
}
