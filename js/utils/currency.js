export const toCents = value => Math.round((Number(value) || 0) * 100);
export const fromCents = cents => cents / 100;
export const formatCurrency = value => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
export const formatCents = cents => formatCurrency(fromCents(cents));
