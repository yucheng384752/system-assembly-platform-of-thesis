import { compile, type ProjectFile } from '../../../libs/aov-core';
import { checkProjectDetails, MATERIAL_DIMENSIONS, type MaterialDimension, type ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { checkFormLibrary, type FormLibrary } from '../../../libs/aov-integration/formLibrary';
import { canvasWithLayout } from './kitExamples';
import type { GraphNode } from './workflowGraph';

export function projectToCanvas(project: ProjectFile) {
  if (!project || !project.meta || !Array.isArray(project.nodes) || !Array.isArray(project.flows) || !Array.isArray(project.artifactTypes)) {
    throw new Error('專案檔缺少專案資料、節點、連線或物料清單。');
  }
  const fail = (name: string, reason: string): never => { throw new Error(`節點「${name || '未命名節點'}」${reason}。`); };
  for (const node of project.nodes) {
    if (!node || typeof node.id !== 'string' || typeof node.name !== 'string'
      || !Array.isArray(node.inputs) || !Array.isArray(node.outputs)
      || [...node.inputs, ...node.outputs].some(p => !p || typeof p.type !== 'string')) {
      fail(node?.name, '缺少名稱或完整的物料輸入與輸出');
    }
  }
  const details: ProjectDetails = { format: 'composer-project-details', version: 1, materials: [], nodes: {} };
  for (const type of project.artifactTypes) {
    const name = project.nodes.find(n => [...(n?.inputs ?? []), ...(n?.outputs ?? [])].some(p => p?.type === type?.id))?.name ?? project.nodes[0]?.name ?? '未命名節點';
    if (!type || !/^lot\.[A-Za-z_][A-Za-z0-9_]*$/.test(type.id)) fail(name, '的物料識別碼無法還原');
    if (!type.quantity || !MATERIAL_DIMENSIONS.includes(type.quantity.dimension as MaterialDimension)) fail(name, '的物料量綱不支援');
    if (!type.name) fail(name, '的物料缺少名稱');
    details.materials.push({ key: type.id.slice(4), name: type.name!, dimension: type.quantity!.dimension as MaterialDimension, baseUnit: type.quantity!.baseUnit });
  }
  const working: GraphNode[] = project.nodes.map(node => {
    const port = node.category === 'source' ? node.outputs[0] : node.inputs[0];
    const material = details.materials.find(m => `lot.${m.key}` === port?.type)?.key;
    if (!material) fail(node.name, '找不到使用的物料型別');
    if (node.category === 'source' && node.boundary?.kind === 'warehouse') {
      details.nodes = { ...details.nodes, [node.id]: { kind: 'pick', material: material!, location: node.boundary.location ?? '' } };
    } else if (node.category === 'sink' && node.boundary) {
      const direction = node.boundary.kind === 'warehouse' ? 'stock-in' : node.boundary.kind === 'customer' ? 'ship-customer' : node.boundary.kind === 'external' ? 'ship-external' : undefined;
      if (!direction) fail(node.name, '的出庫方向無法辨識');
      details.nodes = { ...details.nodes, [node.id]: { kind: 'sink', direction: direction!, material: material!, location: node.boundary.location ?? '' } };
    } else if (node.category === 'measure' && node.form) {
      details.nodes = { ...details.nodes, [node.id]: { kind: 'fill', material: material!, form: node.form, requires: {} } };
    } else fail(node.name, '的物料流類別或必要設定無法辨識');
    return { id: node.id, name: node.name, kind: 'node', when: '', owner: '', actionId: null, params: {}, formId: null, childGraphId: null };
  });
  const forms: FormLibrary = { format: 'composer-form-library', version: 1, forms: project.forms ?? [] };
  const problems = checkProjectDetails(details);
  if (problems.length) fail(project.nodes.find(n => n.id === problems[0].nodeId)?.name ?? project.nodes[0]?.name, '的物料設定不完整或不合法');
  if (checkFormLibrary(forms).length) throw new Error('專案內的表單內容不完整或不合法。');
  let errors;
  try { errors = compile(project).diagnostics.filter(d => d.severity === 'error'); }
  catch { throw new Error('專案檔的內容或連線不完整。'); }
  if (errors.length) {
    const problem = errors[0];
    const edge = project.flows.find(f => f?.id === problem.flowId);
    fail(project.nodes.find(n => n.id === problem.nodeId || n.id === edge?.from.node)?.name ?? project.nodes[0]?.name, '的專案內容或連線未通過檢查');
  }
  let value;
  try { value = canvasWithLayout(`project-${project.meta.id}`, project.meta.name, working, project.flows.map(f => ({ id: f.id, from: f.from.node, to: f.to.node }))); }
  catch { throw new Error('專案檔的節點或連線無法還原成畫布。'); }
  return { value, details, forms, notices: ['專案檔不含觸發時機、負責人、功能與參數，這些已留空'] };
}
