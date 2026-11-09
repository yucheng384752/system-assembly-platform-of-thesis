import { NodeDetailsStep } from './NodeDetailsStep';
import { ProjectFileDownload } from './ProjectFileDownload';
import { emptyProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { emptyFormLibrary } from '../../../libs/aov-integration/formLibrary';
import { useState } from 'react';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowTransfer } from './WorkflowTransfer';
import { ExampleLibrary } from './ExampleLibrary';
import { emptyGraph, exportAovGraph } from './workflowGraph';
import { downloadJson } from './fileTransfer';
import { Icon } from './Icons';

export function App() {
  const [details, setDetails] = useState(emptyProjectDetails);
  const [forms, setForms] = useState(emptyFormLibrary);
  const [graph, setGraph] = useState(emptyGraph);
  const [path, setPath] = useState<string[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  function download() {
    try {
      downloadJson(exportAovGraph(graph), 'aov-flow.json');
      setError(''); setStatus('已下載流程規格');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '無法下載流程規格，請稍後再試。'); setStatus('');
    }
  }
  return <main className="aov-standalone main-wide">
    <WorkflowCanvas value={graph} onChange={value => { setGraph(value); setError(''); setStatus(''); }} path={path} onPathChange={setPath} resetKey={resetKey}
      toolbarExtra={<>
        <h1>AoV 畫布</h1>
        <WorkflowTransfer onChange={(value, extra) => { if (extra) { setDetails(extra.details); setForms(extra.forms); } setGraph(value); setPath([]); setResetKey(key => key + 1); setError(''); setStatus(''); }} />
        <ExampleLibrary current={graph} onLoad={value => { setGraph(value); setPath([]); setResetKey(key => key + 1); setError(''); setStatus(''); }} />
        <button className="primary aov-download" onClick={download}><Icon name="download" />下載流程規格</button>
        {error && <p className="aov-message" role="alert">{error}</p>}
        {status && <p className="aov-message" role="status">{status}</p>}
        <p className="aov-message">關閉或重新整理前請先下載流程規格</p>
      </>} />
    <section className="project-file-section" aria-label="節點細項"><h2>節點細項</h2><NodeDetailsStep graph={graph} details={details} forms={forms} onChange={setDetails} onFormsChange={setForms} /></section>
    <ProjectFileDownload graph={graph} details={details} forms={forms} />
  </main>;
}
