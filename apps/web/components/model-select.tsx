"use client";

import type { ProviderModelOption } from "@agentswarm/shared-types";
import { AutoComplete, Spin } from "antd";
import type { CSSProperties } from "react";

interface ModelSelectProps {
  value?: string;
  options: ProviderModelOption[];
  loading?: boolean;
  disabled?: boolean;
  allowCustom?: boolean;
  placeholder?: string;
  style?: CSSProperties;
  onChange?: (value: string) => void;
}

export function ModelSelect({
  value,
  options,
  loading = false,
  disabled = false,
  allowCustom = true,
  placeholder = "Select or enter model",
  style,
  onChange
}: ModelSelectProps) {
  return (
    <AutoComplete
      value={value}
      options={options}
      disabled={disabled}
      placeholder={placeholder}
      style={style}
      onChange={onChange}
      filterOption={(inputValue, option) => {
        const query = inputValue.toLowerCase();
        return String(option?.value ?? "").toLowerCase().includes(query) || String(option?.label ?? "").toLowerCase().includes(query);
      }}
      notFoundContent={loading ? <Spin size="small" /> : allowCustom ? "Enter a custom model name" : null}
      onSelect={onChange}
      onBlur={() => {
        if (!allowCustom && value && !options.some((option) => option.value === value)) {
          onChange?.("");
        }
      }}
      allowClear
    />
  );
}
