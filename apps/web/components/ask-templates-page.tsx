"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AskTemplate, AskTemplateSummary, AskTemplateVersion, Team } from "@verft/shared-types";
import { Button, Card, Descriptions, Divider, Empty, Flex, Form, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Tag, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { api } from "../src/api/client";
import { useAuth } from "./auth-provider";

type TemplateFormValues = Pick<AskTemplate, "name" | "description" | "prompt" | "outputFormat" | "visibility" | "sharedTeamIds"> & { variables: AskTemplate["variables"] };
const blank: TemplateFormValues = { name: "", description: "", prompt: "", outputFormat: "", variables: [], visibility: "private", sharedTeamIds: [] };
const isAdmin = (roles: { id: string }[]) => roles.some((role) => role.id === "admin");

export function AskTemplatesPage() {
  const router = useRouter();
  const { can, session } = useAuth();
  const [templates, setTemplates] = useState<AskTemplateSummary[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AskTemplate | null>(null);
  const [history, setHistory] = useState<AskTemplateVersion[] | null>(null);
  const [form] = Form.useForm<TemplateFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const canCreate = can("template:create");
  const canEdit = can("template:edit");
  const canDelete = can("template:delete");
  const canShare = can("template:share");
  const canRead = can("template:read");
  const currentUserId = session?.user.id;

  const load = async () => {
    setLoading(true);
    try { setTemplates(await api.listAskTemplates()); }
    catch (error) { messageApi.error(error instanceof Error ? error.message : "Failed to load templates"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const canManage = (template: Pick<AskTemplateSummary, "ownerUserId">) =>
    template.ownerUserId === currentUserId || isAdmin(session?.user.roles ?? []);

  const openEditor = async (id?: string) => {
    if (canShare && teams.length === 0) {
      try { setTeams(await api.listTeams()); } catch { /* Sharing remains usable only when teams load. */ }
    }
    if (!id) {
      setEditing({ id: "", ownerUserId: currentUserId ?? null, ownerName: null, ...blank, version: 1, createdAt: "", updatedAt: "" });
      form.setFieldsValue(blank);
      return;
    }
    try {
      const template = await api.getAskTemplate(id);
      setEditing(template);
      form.setFieldsValue(template);
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "Failed to open template"); }
  };

  const save = async (values: TemplateFormValues) => {
    const input = { name: values.name, description: values.description, prompt: values.prompt, outputFormat: values.outputFormat, variables: values.variables ?? [] };
    try {
      let template = editing?.id ? await api.updateAskTemplate(editing.id, input) : await api.createAskTemplate(input);
      if (canShare && (values.visibility !== "private" || (editing && editing.visibility !== values.visibility))) {
        template = await api.updateAskTemplateSharing(template.id, { visibility: values.visibility, sharedTeamIds: values.sharedTeamIds ?? [] });
      }
      setEditing(null);
      messageApi.success("Template saved");
      await load();
    } catch (error) { messageApi.error(error instanceof Error ? error.message : "Template could not be saved"); }
  };

  const openHistory = async (id: string) => {
    try { setHistory(await api.listAskTemplateVersions(id)); }
    catch (error) { messageApi.error(error instanceof Error ? error.message : "Failed to load history"); }
  };

  if (!can("template:list")) return <Empty description="You do not have permission to view templates." />;

  return <>
    {contextHolder}
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
        <div><Typography.Title level={2} style={{ margin: 0 }}>Ask Templates</Typography.Title><Typography.Text type="secondary">Reusable Ask prompts with named input fields.</Typography.Text></div>
        {canCreate ? <Button type="primary" icon={<PlusOutlined />} onClick={() => void openEditor()}>New Template</Button> : null}
      </Flex>
      {loading ? <Spin /> : templates.length === 0 ? <Empty description="No templates available." /> : <Flex vertical gap={12}>
        {templates.map((template) => <Card key={template.id} size="small">
          <Flex justify="space-between" align="start" gap={16} wrap="wrap">
            <div><Space wrap><Typography.Text strong>{template.name}</Typography.Text><Tag color={template.visibility === "global" ? "purple" : template.visibility === "teams" ? "blue" : "default"}>{template.visibility}</Tag><Tag>v{template.version}</Tag></Space><Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>{template.description || "No description"}</Typography.Paragraph><Typography.Text type="secondary">Owner: {template.ownerName ?? "Former user"}</Typography.Text></div>
            <Space wrap>
              {canRead ? <Button type="primary" onClick={() => router.push(`/tasks/new?template=${encodeURIComponent(template.id)}`)}>Use</Button> : null}
              {canEdit && canManage(template) ? <Button onClick={() => void openEditor(template.id)}>Edit</Button> : null}
              {canRead && canManage(template) ? <Button onClick={() => void openHistory(template.id)}>History</Button> : null}
              {canDelete && canManage(template) ? <Popconfirm title="Delete this template?" onConfirm={async () => { await api.deleteAskTemplate(template.id); await load(); }}><Button danger>Delete</Button></Popconfirm> : null}
            </Space>
          </Flex>
        </Card>)}
      </Flex>}
    </Flex>
    <Modal open={Boolean(editing)} title={editing?.id ? "Edit Ask Template" : "New Ask Template"} width={820} onCancel={() => setEditing(null)} footer={null} destroyOnClose>
      <Form form={form} layout="vertical" initialValues={blank} onFinish={(values) => void save(values)}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="description" label="Description"><Input /></Form.Item>
        <Form.Item name="prompt" label="Prompt" rules={[{ required: true }]}><Input.TextArea autoSize={{ minRows: 6 }} placeholder="Use {{variable_name}} for configured fields." /></Form.Item>
        <Form.Item name="outputFormat" label="Markdown answer format" rules={[{ required: true }]}><Input.TextArea autoSize={{ minRows: 5 }} /></Form.Item>
        <Typography.Text strong>Input fields</Typography.Text>
        <Form.List name="variables">{(fields, { add, remove }) => <Flex vertical gap={8} style={{ marginTop: 8 }}>{fields.map((field) => <Card key={field.key} size="small"><Flex gap={8} wrap="wrap"><Form.Item {...field} name={[field.name, "key"]} rules={[{ required: true }]} label="Key"><Input placeholder="customer" /></Form.Item><Form.Item {...field} name={[field.name, "label"]} rules={[{ required: true }]} label="Label"><Input /></Form.Item><Form.Item {...field} name={[field.name, "type"]} initialValue="text" label="Type"><Select options={[{ value: "text" }, { value: "multiline" }]} /></Form.Item><Form.Item {...field} name={[field.name, "required"]} valuePropName="checked" initialValue={false} label="Required"><Switch /></Form.Item><Button danger onClick={() => remove(field.name)}>Remove</Button></Flex><Form.Item {...field} name={[field.name, "description"]} label="Help"><Input /></Form.Item><Form.Item {...field} name={[field.name, "defaultValue"]} label="Default"><Input /></Form.Item></Card>)}<Button onClick={() => add({ type: "text", required: false, description: "", defaultValue: "" })}>Add field</Button></Flex>}</Form.List>
        {canShare ? <><Divider /><Form.Item name="visibility" label="Sharing"><Select options={[{ value: "private", label: "Only me" }, { value: "teams", label: "Selected teams" }, { value: "global", label: "Global" }]} /></Form.Item><Form.Item noStyle shouldUpdate={(previous, next) => previous.visibility !== next.visibility}>{({ getFieldValue }) => getFieldValue("visibility") === "teams" ? <Form.Item name="sharedTeamIds" label="Teams" rules={[{ required: true }]}><Select mode="multiple" options={teams.map((team) => ({ value: team.id, label: team.name }))} /></Form.Item> : null}</Form.Item></> : null}
        <Flex justify="end" gap={8}><Button onClick={() => setEditing(null)}>Cancel</Button><Button htmlType="submit" type="primary">Save</Button></Flex>
      </Form>
    </Modal>
    <Modal open={Boolean(history)} title="Template history" footer={<Button onClick={() => setHistory(null)}>Close</Button>} onCancel={() => setHistory(null)}>{history?.map((version) => <Card key={version.version} size="small" style={{ marginBottom: 8 }}><Descriptions size="small" column={1} items={[{ key: "version", label: "Version", children: `v${version.version}` }, { key: "changed", label: "Changed by", children: version.changedByName ?? "Former user" }, { key: "when", label: "When", children: version.createdAt }]} />{canEdit ? <Button onClick={async () => { const template = await api.restoreAskTemplateVersion(version.templateId, version.version); setHistory(null); await load(); messageApi.success(`Restored as v${template.version}`); }}>Restore this version</Button> : null}</Card>)}</Modal>
  </>;
}
