import { CATEGORIES } from "@craigsnotice/types";
import { Label } from "@sudobility/components";

export interface CategoryPickerProps {
  value: string;
  onChange(code: string): void;
}

export const CategoryPicker = ({ value, onChange }: CategoryPickerProps) => (
  <div>
    <Label htmlFor="category" className="eyebrow mb-2 block">
      Category
    </Label>
    <select
      id="category"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="field appearance-none"
    >
      {CATEGORIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </select>
  </div>
);
