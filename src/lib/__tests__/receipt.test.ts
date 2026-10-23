import { describe, expect, it } from 'vitest';

import {
	parseReceiptAmount,
	parseReceiptText,
	getReceiptItemsTotalAmount,
	groupReceiptItemsByCategory,
	buildReceiptItemsComment
} from '@/lib/receipt.ts';

const SUPERMARKET_RECEIPT = `RAGU/SPECK 180g×2p

1.99 B

RAGU/SPECK 180gx2p

1.99 B

1 PZ x 0.49 EUR/PZ

0.49 D

BAGUETTE 2509

3.29 D

PATATE NOVELLE 1.5kg

3.29 D

PATATE NOVELLE 1.5kg

0.99 B

YOGURT B.0.1% 500g

SUBTOTAL

12.04`;

describe('parseReceiptAmount', () => {
	it('should parse dot and comma decimals', () => {
		expect(parseReceiptAmount('1.99')).toBe(199);
		expect(parseReceiptAmount('3,29')).toBe(329);
	});

	it('should parse thousands separators', () => {
		expect(parseReceiptAmount('1.234,50')).toBe(123450);
		expect(parseReceiptAmount('1,234.50')).toBe(123450);
	});

	it('should parse leading and trailing minus as negative', () => {
		expect(parseReceiptAmount('-0,50')).toBe(-50);
		expect(parseReceiptAmount('0,50-')).toBe(-50);
	});

	it('should return null for values without two decimals', () => {
		expect(parseReceiptAmount('12')).toBeNull();
		expect(parseReceiptAmount('1.5')).toBeNull();
	});
});

describe('parseReceiptText', () => {
	it('should pair item names with prices printed on separate lines', () => {
		const receipt = parseReceiptText(SUPERMARKET_RECEIPT);

		expect(receipt.items.map(item => [item.line, item.amount])).toEqual([
			['RAGU/SPECK 180g×2p', 199],
			['RAGU/SPECK 180gx2p', 199],
			['BAGUETTE 2509', 49],
			['PATATE NOVELLE 1.5kg', 329],
			['PATATE NOVELLE 1.5kg', 329],
			['YOGURT B.0.1% 500g', 99]
		]);
		expect(receipt.items[2]?.detail).toBe('1 PZ x 0.49 EUR/PZ');
		expect(receipt.total).toBe(1204);
		expect(receipt.hasUnpairedLines).toBe(false);
		expect(getReceiptItemsTotalAmount(receipt.items)).toBe(1204);
	});

	it('should skip the store name before items with prices on the same line', () => {
		const receipt = parseReceiptText(`NAUTICA SRL
Via del Porto 3
TUBO PVC 5M 12,50 A
CIMA 8MM 22,00 A
TOTALE 34,50`);

		expect(receipt.items.map(item => [item.line, item.amount])).toEqual([
			['TUBO PVC 5M', 1250],
			['CIMA 8MM', 2200]
		]);
		expect(receipt.hasUnpairedLines).toBe(false);
	});

	it('should keep a name without price between items as unpaired', () => {
		const receipt = parseReceiptText(`TUBO PVC 5M 12,50 A
GUANTI DA LAVORO
CIMA 8MM 22,00 A`);

		expect(receipt.items.map(item => [item.line, item.amount, item.paired])).toEqual([
			['TUBO PVC 5M', 1250, true],
			['GUANTI DA LAVORO', 0, false],
			['CIMA 8MM', 2200, true]
		]);
		expect(receipt.hasUnpairedLines).toBe(true);
	});

	it('should parse prices printed on the same line as item names', () => {
		const receipt = parseReceiptText(`HOSE 1/2" PVC 5M  12,50 A
ROPE 10MM BRAIDED 22,00 A
SCREWDRIVER SET 8,90 A
TOTALE EURO 43,40`);

		expect(receipt.items.map(item => [item.line, item.amount])).toEqual([
			['HOSE 1/2" PVC 5M', 1250],
			['ROPE 10MM BRAIDED', 2200],
			['SCREWDRIVER SET', 890]
		]);
		expect(receipt.total).toBe(4340);
		expect(receipt.hasUnpairedLines).toBe(false);
	});

	it('should skip header lines and keep the prices aligned to the last items', () => {
		const receipt = parseReceiptText(`SUPERMERCATO ROSSI
di vendita o prestazione
P.IVA 01234567890
Via Roma 12
DOCUMENTO COMMERCIALE
LATTE INTERO 1L
1,29 B
PANE COMUNE
2,10 D
TOTALE
3,39`);

		expect(receipt.items.map(item => [item.line, item.amount])).toEqual([
			['LATTE INTERO 1L', 129],
			['PANE COMUNE', 210]
		]);
		expect(receipt.hasUnpairedLines).toBe(false);
		expect(receipt.total).toBe(339);
	});

	it('should apply discounts to the item before them', () => {
		const receipt = parseReceiptText(`MOZZARELLA 125G
1,49 B
SCONTO 20%
-0,30
POMODORI
2,00 D
SCONTO -0,50
TOTALE 2,69`);

		expect(receipt.items.map(item => [item.line, item.amount])).toEqual([
			['MOZZARELLA 125G', 119],
			['POMODORI', 150]
		]);
		expect(receipt.total).toBe(269);
	});

	it('should apply trailing minus discounts', () => {
		const receipt = parseReceiptText(`BISCOTTI 4,50 B
0,90-
TOTALE 3,60`);

		expect(receipt.items.map(item => [item.line, item.amount])).toEqual([['BISCOTTI', 360]]);
	});

	it('should keep a discount after the subtotal as a separate line', () => {
		const receipt = parseReceiptText(`ACQUA 6X1,5L 2,40 A
SUBTOTALE 2,40
SCONTO FIDELITY -0,40
TOTALE 2,00`);

		expect(receipt.items.map(item => [item.line, item.amount])).toEqual([
			['ACQUA 6X1,5L', 240],
			['SCONTO FIDELITY', -40]
		]);
		expect(receipt.total).toBe(200);
	});

	it('should use the final total and ignore payment lines', () => {
		const receipt = parseReceiptText(`CARTA IGIENICA 4 ROTOLI
2,99 A
SUBTOTALE
2,99
TOTALE
2,99
CONTANTE
5,00
RESTO
2,01`);

		expect(receipt.items.map(item => [item.line, item.amount])).toEqual([['CARTA IGIENICA 4 ROTOLI', 299]]);
		expect(receipt.total).toBe(299);
	});

	it('should attach weight details to the following item', () => {
		const receipt = parseReceiptText(`0,512 kg x 2,99 €/kg
MELE GOLDEN
1,53 D`);

		expect(receipt.items).toEqual([{ line: 'MELE GOLDEN', detail: '0,512 kg x 2,99 €/kg', amount: 153, paired: true }]);
	});

	it('should report prices without item names as unpaired', () => {
		const receipt = parseReceiptText(`LATTE
1,29 B
0,50 B
TOTALE 1,79`);

		expect(receipt.hasUnpairedLines).toBe(true);
		expect(receipt.items.map(item => [item.line, item.amount, item.paired])).toEqual([
			['', 129, false],
			['LATTE', 50, true]
		]);
	});

	it('should keep item names when there are no prices at all', () => {
		const receipt = parseReceiptText(`TUBO PVC 5M
CIMA 8MM`);

		expect(receipt.items.map(item => [item.line, item.amount, item.paired])).toEqual([
			['TUBO PVC 5M', 0, false],
			['CIMA 8MM', 0, false]
		]);
	});

	it('should return no items for empty text', () => {
		const receipt = parseReceiptText(' \n \n');

		expect(receipt.items).toEqual([]);
		expect(receipt.total).toBeUndefined();
	});
});

describe('groupReceiptItemsByCategory', () => {
	it('should group items by category in order of first appearance and sum the amounts', () => {
		const groups = groupReceiptItemsByCategory([
			{ line: 'HOSE', amount: 1250, paired: true, categoryId: 'plumbing' },
			{ line: 'ROPE', amount: 2200, paired: true, categoryId: 'ropes' },
			{ line: 'HOSE CLAMP', amount: 300, paired: true, categoryId: 'plumbing' }
		]);

		expect(groups.map(group => [group.categoryId, group.amount, group.items.map(item => item.line)])).toEqual([
			['plumbing', 1550, ['HOSE', 'HOSE CLAMP']],
			['ropes', 2200, ['ROPE']]
		]);
	});
});

describe('buildReceiptItemsComment', () => {
	it('should list the item lines with amounts', () => {
		expect(buildReceiptItemsComment([
			{ line: 'BAGUETTE 250g', amount: 49, paired: true },
			{ line: 'PATATE NOVELLE 1.5kg', amount: 329, paired: true }
		])).toBe('BAGUETTE 250g 0.49\nPATATE NOVELLE 1.5kg 3.29');
	});

	it('should append the extra line after an empty line', () => {
		expect(buildReceiptItemsComment([{ line: 'YOGURT', amount: 99, paired: true }], 'EUR0.99 converted to ILS with template'))
			.toBe('YOGURT 0.99\n\nEUR0.99 converted to ILS with template');
	});

	it('should format negative amounts', () => {
		expect(buildReceiptItemsComment([{ line: 'SCONTO', amount: -40, paired: true }])).toBe('SCONTO -0.40');
	});

	it('should replace trailing items when too long and keep the extra line', () => {
		const items = Array.from({ length: 5 }, (_, i) => ({ line: `ITEM NUMBER ${i + 1}`, amount: 100, paired: true }));
		const comment = buildReceiptItemsComment(items, 'EXTRA', 60);

		expect(comment).toBe('ITEM NUMBER 1 1.00\nITEM NUMBER 2 1.00\n…and 3 more\n\nEXTRA');
		expect(comment.length).toBeLessThanOrEqual(60);
	});
});
