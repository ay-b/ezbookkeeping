import { AMOUNT_FACTOR } from '@/consts/numeral.ts';
import { TRANSACTION_MAX_COMMENT_LENGTH } from '@/consts/transaction.ts';

export interface ParsedReceiptItem {
    line: string;
    detail?: string;
    amount: number; // amount in cents, includes the discounts applied to this item
    paired: boolean; // false when the item name or its price could not be paired from the receipt text
}

export interface ParsedReceipt {
    items: ParsedReceiptItem[];
    total?: number; // the total (or subtotal) printed on the receipt, in cents
    hasUnpairedLines: boolean;
}

export interface ReceiptItemGroup<T extends ParsedReceiptItem> {
    categoryId: string;
    amount: number;
    items: T[];
}

const PRICE_PATTERN = '(-?\\s?\\d{1,7}(?:[.,]\\d{3})*[.,]\\d{2}-?)';
const PRICE_LINE_REGEX = new RegExp(`^(?:€|EUR)?\\s*${PRICE_PATTERN}\\s*(?:€|EUR)?\\s*(?:[A-Z]{1,2}|\\d{1,2}(?:[.,]\\d+)?\\s?%)?\\s*\\*?$`, 'i');
const INLINE_PRICE_REGEX = new RegExp(`^(.*?[A-Za-zÀ-ÿ].*?)\\s+(?:€|EUR)?\\s*${PRICE_PATTERN}\\s*(?:€|EUR)?\\s*(?:[A-Z]{1,2}|\\d{1,2}(?:[.,]\\d+)?\\s?%)?\\s*\\*?$`, 'i');
const QUANTITY_DETAIL_REGEX = /\d+(?:[.,]\d+)?\s*(?:pz|pcs?|kg|g|gr|lt?|n|nr)?\.?\s*[x×*]\s*(?:€|EUR)?\s*\d+[.,]\d{2,3}/i;
const TOTAL_KEYWORD_REGEX = /^(?:sub\s*-?\s*total[e]?|totale(?:\s+complessivo)?|total|importo(?:\s+pagato)?|tot\.?)(?=$|[\s:.€]|\d)/i;
const DISCOUNT_KEYWORD_REGEX = /^(?:sconto|sconti|discount|riduzione|promo|promozione|offerta|coupon|buono)\b/i;
const NOISE_LINE_REGEX = /^(?:p\.?\s?iva|partita iva|c\.?\s?f\.?|cod\.?\s?fisc|via\s|viale\s|piazza\s|corso\s|tel\.?|telefono|documento commerciale|scontrino|ricevuta|descrizione|prezzo|euro$|€$|cassa|operatore|cassiere|grazie|arrivederci|www\.|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}:\d{2})/i;

type ReceiptToken =
    | { kind: 'name', position: number, line: string, detail?: string }
    | { kind: 'price', position: number, amount: number }
    | { kind: 'item', position: number, line: string, detail?: string, amount: number }
    | { kind: 'discount', position: number, line?: string, amount: number, afterTotal: boolean };

export function parseReceiptAmount(text: string): number | null {
    let value = text.replace(/\s/g, '');
    let negative = false;

    if (value.startsWith('-')) {
        negative = true;
        value = value.substring(1);
    }

    if (value.endsWith('-')) {
        negative = true;
        value = value.substring(0, value.length - 1);
    }

    const decimalSeparator = value.charAt(value.length - 3);

    if (decimalSeparator !== '.' && decimalSeparator !== ',') {
        return null;
    }

    const integerPart = value.substring(0, value.length - 3).replace(/[.,]/g, '');
    const decimalPart = value.substring(value.length - 2);
    const amount = parseInt(integerPart, 10) * AMOUNT_FACTOR + parseInt(decimalPart, 10);

    if (!Number.isFinite(amount)) {
        return null;
    }

    return negative ? -amount : amount;
}

function getPriceFromLine(line: string): number | null {
    const match = PRICE_LINE_REGEX.exec(line);
    return match && match[1] ? parseReceiptAmount(match[1]) : null;
}

function getInlinePrice(line: string): { line: string, amount: number } | null {
    const match = INLINE_PRICE_REGEX.exec(line);
    const amount = match && match[2] ? parseReceiptAmount(match[2]) : null;
    return match && match[1] && amount !== null ? { line: match[1].trim(), amount: amount } : null;
}

function tokenizeReceiptText(text: string): { tokens: ReceiptToken[], total?: number } {
    const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 0);
    const tokens: ReceiptToken[] = [];
    let pendingDetail: string | undefined = undefined;
    let pendingDiscountLine: string | undefined = undefined;
    let totalKeywordFound = false;
    let expectTotalPrice = false;
    let total: number | undefined = undefined;

    for (let position = 0; position < lines.length; position++) {
        const line = lines[position] as string;

        if (TOTAL_KEYWORD_REGEX.test(line)) {
            const inlineTotal = getInlinePrice(line);
            totalKeywordFound = true;

            if (inlineTotal) {
                total = inlineTotal.amount;
                expectTotalPrice = false;
            } else {
                expectTotalPrice = true;
            }

            continue;
        }

        const price = getPriceFromLine(line);

        if (price !== null) {
            if (expectTotalPrice) {
                total = price;
                expectTotalPrice = false;
            } else if (pendingDiscountLine !== undefined || price < 0) {
                tokens.push({ kind: 'discount', position: position, line: pendingDiscountLine || undefined, amount: -Math.abs(price), afterTotal: totalKeywordFound });
                pendingDiscountLine = undefined;
            } else if (!totalKeywordFound) {
                tokens.push({ kind: 'price', position: position, amount: price });
            }

            continue;
        }

        expectTotalPrice = false;

        if (DISCOUNT_KEYWORD_REGEX.test(line)) {
            const inlineDiscount = getInlinePrice(line);

            if (inlineDiscount) {
                tokens.push({ kind: 'discount', position: position, line: inlineDiscount.line, amount: -Math.abs(inlineDiscount.amount), afterTotal: totalKeywordFound });
            } else {
                pendingDiscountLine = line;
            }

            continue;
        }

        if (totalKeywordFound) {
            continue;
        }

        if (QUANTITY_DETAIL_REGEX.test(line)) {
            pendingDetail = pendingDetail ? `${pendingDetail} ${line}` : line;
            continue;
        }

        if (NOISE_LINE_REGEX.test(line) || !/[A-Za-zÀ-ÿ]{2,}/.test(line)) {
            continue;
        }

        const inlineItem = getInlinePrice(line);

        if (inlineItem) {
            tokens.push({ kind: 'item', position: position, line: inlineItem.line, detail: pendingDetail, amount: inlineItem.amount });
        } else {
            tokens.push({ kind: 'name', position: position, line: line, detail: pendingDetail });
        }

        pendingDetail = undefined;
    }

    // a quantity detail printed after the last item belongs to that item
    if (pendingDetail) {
        for (let i = tokens.length - 1; i >= 0; i--) {
            const token = tokens[i] as ReceiptToken;

            if (token.kind === 'name' || token.kind === 'item') {
                token.detail = token.detail ? `${token.detail} ${pendingDetail}` : pendingDetail;
                break;
            }
        }
    }

    return { tokens, total };
}

// parses the receipt text (e.g. recognized from a photo of a paper receipt) into the item lines with their prices
// item names and prices printed on separate lines are paired in order from the end of the item list,
// so that unrecognized header lines at the beginning of the receipt do not shift the prices of all items
export function parseReceiptText(text: string): ParsedReceipt {
    const { tokens, total } = tokenizeReceiptText(text);
    const names = tokens.filter(token => token.kind === 'name') as Extract<ReceiptToken, { kind: 'name' }>[];
    const prices = tokens.filter(token => token.kind === 'price') as Extract<ReceiptToken, { kind: 'price' }>[];
    const positionedItems: { position: number, item: ParsedReceiptItem }[] = [];
    const pairedCount = Math.min(names.length, prices.length);

    for (let i = 0; i < pairedCount; i++) {
        const name = names[names.length - 1 - i] as Extract<ReceiptToken, { kind: 'name' }>;
        const price = prices[prices.length - 1 - i] as Extract<ReceiptToken, { kind: 'price' }>;
        positionedItems.push({ position: price.position, item: { line: name.line, detail: name.detail, amount: price.amount, paired: true } });
    }

    const firstPricePosition = Math.min(...tokens.filter(token => token.kind === 'price' || token.kind === 'item').map(token => token.position));
    let unpairedNameCount = 0;

    for (let i = 0; i < names.length - pairedCount; i++) {
        const name = names[i] as Extract<ReceiptToken, { kind: 'name' }>;

        // name lines before the first price are the receipt header (store name, address, etc.) when there are no unpaired prices
        if (Number.isFinite(firstPricePosition) && prices.length <= names.length && name.position < firstPricePosition) {
            continue;
        }

        positionedItems.push({ position: name.position, item: { line: name.line, detail: name.detail, amount: 0, paired: false } });
        unpairedNameCount++;
    }

    for (let i = 0; i < prices.length - pairedCount; i++) {
        const price = prices[i] as Extract<ReceiptToken, { kind: 'price' }>;
        positionedItems.push({ position: price.position, item: { line: '', amount: price.amount, paired: false } });
    }

    for (const token of tokens) {
        if (token.kind === 'item') {
            positionedItems.push({ position: token.position, item: { line: token.line, detail: token.detail, amount: token.amount, paired: true } });
        }
    }

    positionedItems.sort((item1, item2) => item1.position - item2.position);

    for (const token of tokens) {
        if (token.kind !== 'discount') {
            continue;
        }

        let discountedItem: { position: number, item: ParsedReceiptItem } | undefined = undefined;

        if (!token.afterTotal) {
            for (const positionedItem of positionedItems) {
                if (positionedItem.position < token.position && positionedItem.item.amount > 0) {
                    discountedItem = positionedItem;
                }
            }
        }

        if (discountedItem) {
            discountedItem.item.amount += token.amount;
        } else {
            positionedItems.push({ position: token.position, item: { line: token.line || 'Discount', amount: token.amount, paired: true } });
        }
    }

    positionedItems.sort((item1, item2) => item1.position - item2.position);

    return {
        items: positionedItems.map(positionedItem => positionedItem.item),
        total: total,
        hasUnpairedLines: unpairedNameCount > 0 || prices.length > names.length
    };
}

export function getReceiptItemsTotalAmount(items: { amount: number }[]): number {
    let total = 0;

    for (const item of items) {
        total += item.amount;
    }

    return total;
}

// groups the items by category in the order of the first item of each category
export function groupReceiptItemsByCategory<T extends ParsedReceiptItem & { categoryId: string }>(items: T[]): ReceiptItemGroup<T>[] {
    const groups: ReceiptItemGroup<T>[] = [];
    const groupMap: Record<string, ReceiptItemGroup<T>> = {};

    for (const item of items) {
        let group = groupMap[item.categoryId];

        if (!group) {
            group = { categoryId: item.categoryId, amount: 0, items: [] };
            groupMap[item.categoryId] = group;
            groups.push(group);
        }

        group.amount += item.amount;
        group.items.push(item);
    }

    return groups;
}

function formatReceiptAmount(amount: number): string {
    const sign = amount < 0 ? '-' : '';
    const absAmount = Math.abs(amount);
    return `${sign}${Math.floor(absAmount / AMOUNT_FACTOR)}.${String(absAmount % AMOUNT_FACTOR).padStart(2, '0')}`;
}

// returns the description which lists the receipt lines of the items, the trailing items are replaced by "...and N more" when the description is too long
export function buildReceiptItemsComment(items: ParsedReceiptItem[], extraLine?: string, maxLength: number = TRANSACTION_MAX_COMMENT_LENGTH): string {
    const itemLines = items.map(item => `${item.line} ${formatReceiptAmount(item.amount)}`);
    const suffix = extraLine ? `\n\n${extraLine}` : '';

    for (let count = itemLines.length; count >= 0; count--) {
        const lines = itemLines.slice(0, count);

        if (count < itemLines.length) {
            lines.push(`…and ${itemLines.length - count} more`);
        }

        const comment = lines.join('\n') + suffix;

        if (comment.length <= maxLength) {
            return comment;
        }
    }

    return suffix.trim().substring(0, maxLength);
}
