import type { AccessProfile, RequestDetail, WarehouseCode } from '@glorychips/contracts';

export const managedWarehouseCodes = (access: AccessProfile): readonly WarehouseCode[] =>
  access.roles.includes('SYSTEM_ADMIN') ? ['XIHU', 'YUHANG'] : access.warehouses;

export const validReturnQuantities = (
  obligations: readonly Pick<
    RequestDetail['returnObligations'][number],
    'id' | 'remainingQuantity'
  >[],
  quantities: Readonly<Record<string, string>>,
): boolean => {
  const values = obligations.map((obligation) => ({
    remainingQuantity: obligation.remainingQuantity,
    quantity: Number(quantities[obligation.id] ?? '0'),
  }));
  return (
    values.some((item) => item.quantity > 0) &&
    values.every(
      (item) =>
        item.quantity === 0 ||
        (Number.isSafeInteger(item.quantity) &&
          item.quantity > 0 &&
          item.quantity <= item.remainingQuantity),
    )
  );
};

export const shanghaiCalendarDefaults = (
  value = new Date(),
): { date: string; from: string; to: string } => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('Unable to calculate the Shanghai calendar date.');
  }
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    date: `${year}-${month}-${day}`,
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  };
};
