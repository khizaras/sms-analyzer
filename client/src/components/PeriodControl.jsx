import { useMemo, useState } from 'react';
import { Segmented } from 'antd';
import dayjs from 'dayjs';

export function rangeFor(key) {
  const end = dayjs().endOf('day');
  if (key === '30') {
    return { from: dayjs().subtract(29, 'day').startOf('day').toISOString(), to: end.toISOString(), label: 'Last 30 days' };
  }
  if (key === '90') {
    return { from: dayjs().subtract(89, 'day').startOf('day').toISOString(), to: end.toISOString(), label: 'Last 90 days' };
  }
  if (key === 'year') {
    return { from: dayjs().startOf('year').toISOString(), to: end.toISOString(), label: dayjs().format('YYYY') };
  }
  return { from: dayjs().startOf('month').toISOString(), to: end.toISOString(), label: dayjs().format('MMMM YYYY') };
}

export default function PeriodControl({ value, onChange }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { label: 'This month', value: 'month' },
        { label: '30 days', value: '30' },
        { label: '90 days', value: '90' },
        { label: 'This year', value: 'year' },
      ]}
    />
  );
}

export function usePeriod(defaultKey = 'month') {
  const [key, setKey] = useState(defaultKey);
  const range = useMemo(() => rangeFor(key), [key]);
  return { key, setKey, ...range };
}
