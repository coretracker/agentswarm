import type { Meta, StoryObj } from "@storybook/react";
import type { ProviderModelOption } from "@verft/shared-types";
import { ModelSelect } from "./model-select";

const mockModels: ProviderModelOption[] = [
  { label: "GPT-5.1", value: "gpt-5.1" },
  { label: "GPT-5.1 Mini", value: "gpt-5.1-mini" },
  { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5" },
  { label: "Claude Opus 4.1", value: "claude-opus-4-1" }
];

const meta = {
  title: "Components/ModelSelect",
  component: ModelSelect,
  tags: ["autodocs"],
  args: {
    options: mockModels,
    value: "gpt-5.1",
    placeholder: "Select a model",
    style: { width: 360 }
  }
} satisfies Meta<typeof ModelSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    value: undefined,
    loading: true,
    options: []
  }
};

export const RestrictedToKnownModels: Story = {
  args: {
    allowCustom: false,
    value: "claude-sonnet-4-5"
  }
};
