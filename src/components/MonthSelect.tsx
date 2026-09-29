import { useMemo } from 'react';

type MonthSelectProps = {
  value: string;
  onChange: (value: string) => void;
  pastYears?: number;
  futureYears?: number;
  formatOption?: (value: string) => string;
};

export function MonthSelect({ value, onChange, pastYears = 2, futureYears = 2, formatOption = formatMonthLabel }: MonthSelectProps) {
  const options = useMemo(() => getMonthOptions(value, pastYears, futureYears), [futureYears, pastYears, value]);

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option} value={option}>
          {formatOption(option)}
        </option>
      ))}
    </select>
  );
}

export function formatMonthLabel(value: string) {
  const [yearText, monthText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  if (!year || !month) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

function getMonthOptions(selectedValue: string, pastYears: number, futureYears: number) {
  const now = new Date();
  const start = new Date(now.getFullYear() - pastYears, 0, 1);
  const end = new Date(now.getFullYear() + futureYears, 11, 1);
  const options: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    options.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (selectedValue && !options.includes(selectedValue)) {
    options.push(selectedValue);
    options.sort();
  }

  return options;
}
