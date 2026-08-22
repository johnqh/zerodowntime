import { CATEGORIES } from "@craigsnotice/types";

export interface CategoryPickerProps {
  value: string;
  onChange(code: string): void;
}

export const CategoryPicker = ({ value, onChange }: CategoryPickerProps) => (
  <div>
    <label
      htmlFor="category"
      className="mb-1 block text-sm font-medium text-slate-700"
    >
      Category
    </label>
    <select
      id="category"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 outline-none focus:border-slate-900"
    >
      {CATEGORIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </select>
  </div>
);
