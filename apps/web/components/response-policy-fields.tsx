"use client";

import { Form, Input, Select, Typography } from "antd";

interface ResponsePolicyFieldsProps {
  onChange?: () => void;
}

export function ResponsePolicyFields({ onChange }: ResponsePolicyFieldsProps) {
  return (
    <>
      <Typography.Text type="secondary">
        Control how the agent explains things, uses jargon, and formats answers.
      </Typography.Text>
      <Form.Item name="audience" label="Audience">
        <Select
          allowClear
          placeholder="Neutral"
          options={[
            { label: "Technical", value: "technical" },
            { label: "Non-technical", value: "non_technical" },
            { label: "Mixed", value: "mixed" }
          ]}
          onChange={() => onChange?.()}
        />
      </Form.Item>
      <Form.Item name="explanationDepth" label="Explanation Depth">
        <Select
          allowClear
          placeholder="Default"
          options={[
            { label: "Brief", value: "brief" },
            { label: "Standard", value: "standard" },
            { label: "Detailed", value: "detailed" }
          ]}
          onChange={() => onChange?.()}
        />
      </Form.Item>
      <Form.Item name="jargonLevel" label="Jargon Level">
        <Select
          allowClear
          placeholder="Default"
          options={[
            { label: "Avoid", value: "avoid" },
            { label: "Balanced", value: "balanced" },
            { label: "Expert", value: "expert" }
          ]}
          onChange={() => onChange?.()}
        />
      </Form.Item>
      <Form.Item name="codePreference" label="Code Preference">
        <Select
          allowClear
          placeholder="Default"
          options={[
            { label: "Only When Needed", value: "only_when_needed" },
            { label: "Prefer Examples", value: "prefer_examples" },
            { label: "Avoid Code", value: "avoid_code" }
          ]}
          onChange={() => onChange?.()}
        />
      </Form.Item>
      <Form.Item name="clarifyBehavior" label="Clarify Behavior">
        <Select
          allowClear
          placeholder="Default"
          options={[
            { label: "Ask When Ambiguous", value: "ask_when_ambiguous" },
            { label: "Make Reasonable Assumptions", value: "make_reasonable_assumptions" }
          ]}
          onChange={() => onChange?.()}
        />
      </Form.Item>
      <Form.Item name="formattingStyle" label="Formatting Style">
        <Select
          allowClear
          placeholder="Default"
          options={[
            { label: "Direct", value: "direct" },
            { label: "Teaching", value: "teaching" },
            { label: "Executive", value: "executive" }
          ]}
          onChange={() => onChange?.()}
        />
      </Form.Item>
      <Form.Item name="extraInstructions" label="Extra Instructions">
        <Input.TextArea
          rows={3}
          maxLength={2000}
          placeholder="Optional additional response instructions."
          onChange={() => onChange?.()}
        />
      </Form.Item>
    </>
  );
}

