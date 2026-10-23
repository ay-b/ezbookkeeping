import { describe, expect, it } from 'vitest';

import { getTemplateConversionNoteLine, appendTemplateConversionNoteLine } from '@/lib/template.ts';

describe('getTemplateConversionNoteLine', () => {
	it('should format the template currency amount with two decimals', () => {
		expect(getTemplateConversionNoteLine(2347, 'EUR', 'ILS')).toBe('EUR23.47 converted to ILS with template');
	});

	it('should keep trailing zeros', () => {
		expect(getTemplateConversionNoteLine(5000, 'USD', 'EUR')).toBe('USD50.00 converted to EUR with template');
	});

	it('should format amounts below one', () => {
		expect(getTemplateConversionNoteLine(5, 'EUR', 'USD')).toBe('EUR0.05 converted to USD with template');
	});

	it('should omit decimals for currencies without fraction', () => {
		expect(getTemplateConversionNoteLine(120000, 'JPY', 'EUR')).toBe('JPY1200 converted to EUR with template');
	});

	it('should not show more decimals than amounts are stored with', () => {
		expect(getTemplateConversionNoteLine(1234, 'BHD', 'EUR')).toBe('BHD12.34 converted to EUR with template');
	});

	it('should fall back to two decimals for unknown currencies', () => {
		expect(getTemplateConversionNoteLine(1234, 'XYZ', 'EUR')).toBe('XYZ12.34 converted to EUR with template');
	});
});

describe('appendTemplateConversionNoteLine', () => {
	const line = 'EUR23.47 converted to ILS with template';

	it('should use only the line when description is empty', () => {
		expect(appendTemplateConversionNoteLine('', line)).toBe(line);
	});

	it('should use only the line when description is whitespace', () => {
		expect(appendTemplateConversionNoteLine('  \n ', line)).toBe(line);
	});

	it('should separate the line from description with an empty line', () => {
		expect(appendTemplateConversionNoteLine('Chicken', line)).toBe(`Chicken\n\n${line}`);
	});

	it('should not add extra empty lines after trailing whitespace', () => {
		expect(appendTemplateConversionNoteLine('Chicken\n\n', line)).toBe(`Chicken\n\n${line}`);
	});
});
