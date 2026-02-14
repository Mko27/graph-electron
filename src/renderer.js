// ===== Global Error Handling (shows in DevTools Console) =====
window.onerror = function (message, source, lineno, colno, error) {
  console.error('[renderer] Uncaught error:', message, `\n  at ${source}:${lineno}:${colno}`, error);
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] Unhandled promise rejection:', event.reason);
});

// ===== Neptune Data Helpers =====
// Neptune returns properties as ARRAY: [{key: "name", value: "val"}, ...]
// This converts to a simple map: {name: "val", ...}
function neptunePropsToMap(properties) {
  if (!properties) return {};
  if (Array.isArray(properties)) {
    const map = {};
    properties.forEach(p => {
      if (p && p.key !== undefined) {
        map[p.key] = p.value;
      } else if (p && p.label !== undefined && p.value !== undefined) {
        map[p.label] = p.value;
      }
    });
    return map;
  }
  // Already an object map
  if (typeof properties === 'object') {
    const map = {};
    Object.entries(properties).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        map[k] = v.map(p => p.value !== undefined ? p.value : p).join(', ');
      } else if (v && v.value !== undefined) {
        map[k] = v.value;
      } else {
        map[k] = v;
      }
    });
    return map;
  }
  return {};
}

// Neptune edge IDs can be objects {relationId: "..."}
function resolveId(id) {
  if (id === null || id === undefined) return '';
  if (typeof id === 'string') return id;
  if (typeof id === 'number') return String(id);
  if (typeof id === 'object') {
    if (id.relationId) return id.relationId;
    return JSON.stringify(id);
  }
  return String(id);
}

// Check if an item is an edge (Neptune format)
function isNeptuneEdge(item) {
  return item && typeof item === 'object' &&
    item.outV !== undefined && item.inV !== undefined;
}

// Check if an item is a vertex (Neptune format)
function isNeptuneVertex(item) {
  return item && typeof item === 'object' &&
    item.id !== undefined && item.label !== undefined &&
    item.outV === undefined && item.inV === undefined;
}

// ===== DOM Elements =====
const elements = {
  // Connection
  endpoint: document.getElementById('endpoint'),
  port: document.getElementById('port'),
  useSsl: document.getElementById('useSsl'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  connectionStatus: document.getElementById('connectionStatus'),

  // Schema
  schemaSection: document.getElementById('schemaSection'),
  schemaContent: document.getElementById('schemaContent'),
  refreshSchemaBtn: document.getElementById('refreshSchemaBtn'),

  // Query
  queryEditor: document.getElementById('queryEditor'),
  executeBtn: document.getElementById('executeBtn'),
  clearQueryBtn: document.getElementById('clearQueryBtn'),

  // Results
  resultsMeta: document.getElementById('resultsMeta'),
  tableContainer: document.getElementById('tableContainer'),
  jsonOutput: document.getElementById('jsonOutput'),
  graphCanvas: document.getElementById('graphCanvas'),

  // Tabs
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Status bar
  statusMessage: document.getElementById('statusMessage'),
  queryTime: document.getElementById('queryTime'),
  resultCount: document.getElementById('resultCount'),

  // Query History
  queryHistory: document.getElementById('queryHistory'),

  // Graph controls
  graphFitBtn: document.getElementById('graphFitBtn'),
  graphZoomInBtn: document.getElementById('graphZoomInBtn'),
  graphZoomOutBtn: document.getElementById('graphZoomOutBtn'),
};

// ===== State =====
let isConnected = false;
let isExecuting = false;
let queryHistoryList = [];
let currentResults = null;
let graphNetwork = null;

// ===== Connection =====
elements.connectBtn.addEventListener('click', handleConnect);
elements.disconnectBtn.addEventListener('click', handleDisconnect);

async function handleConnect() {
  const endpoint = elements.endpoint.value.trim();
  const port = parseInt(elements.port.value, 10);
  const useSsl = elements.useSsl.checked;

  if (!endpoint) {
    setStatus('Please enter a Neptune endpoint', 'error');
    return;
  }

  setConnectionStatus('connecting', 'Connecting...');
  elements.connectBtn.disabled = true;

  try {
    console.log('[renderer] Connecting to', endpoint, port, 'SSL:', useSsl);
    const result = await window.neptune.connect({ endpoint, port, useSsl });
    console.log('[renderer] Connect result:', result);
    if (result.success) {
      isConnected = true;
      setConnectionStatus('connected', 'Connected');
      elements.connectBtn.style.display = 'none';
      elements.disconnectBtn.style.display = '';
      elements.schemaSection.style.display = '';
      setStatus(result.message);
      loadSchema();
    } else {
      setConnectionStatus('disconnected', 'Connection failed');
      setStatus(result.message, 'error');
    }
  } catch (err) {
    setConnectionStatus('disconnected', 'Connection failed');
    setStatus(err.message, 'error');
  }

  elements.connectBtn.disabled = false;
}

async function handleDisconnect() {
  await window.neptune.disconnect();
  isConnected = false;
  setConnectionStatus('disconnected', 'Disconnected');
  elements.connectBtn.style.display = '';
  elements.disconnectBtn.style.display = 'none';
  elements.schemaSection.style.display = 'none';
  setStatus('Disconnected');
}

function setConnectionStatus(state, text) {
  elements.connectionStatus.className = `connection-status ${state}`;
  elements.connectionStatus.querySelector('.status-text').textContent = text;
}

// ===== Schema =====
elements.refreshSchemaBtn.addEventListener('click', loadSchema);

async function loadSchema() {
  elements.schemaContent.innerHTML = '<div class="schema-loading"><span class="loading-spinner"></span> Loading schema...</div>';

  try {
    const result = await window.neptune.getSchema();
    if (result.success) {
      renderSchema(result.data);
    } else {
      elements.schemaContent.innerHTML = `<div class="schema-loading">Failed to load schema</div>`;
    }
  } catch (err) {
    elements.schemaContent.innerHTML = `<div class="schema-loading">Error: ${err.message}</div>`;
  }
}

function renderSchema(schema) {
  let html = '';

  if (schema.vertexLabels && schema.vertexLabels.length > 0) {
    html += `
      <div class="schema-group">
        <div class="schema-group-title">🔵 Vertex Labels (${schema.vertexLabels.length})</div>
        <div>${schema.vertexLabels.map(l => `<span class="schema-tag vertex" onclick="insertSchemaQuery('vertex', '${l}')">${l}</span>`).join('')}</div>
      </div>`;
  }

  if (schema.edgeLabels && schema.edgeLabels.length > 0) {
    html += `
      <div class="schema-group">
        <div class="schema-group-title">🟣 Edge Labels (${schema.edgeLabels.length})</div>
        <div>${schema.edgeLabels.map(l => `<span class="schema-tag edge" onclick="insertSchemaQuery('edge', '${l}')">${l}</span>`).join('')}</div>
      </div>`;
  }

  if (schema.vertexProperties && schema.vertexProperties.length > 0) {
    html += `
      <div class="schema-group">
        <div class="schema-group-title">🟡 Properties (${schema.vertexProperties.length})</div>
        <div>${schema.vertexProperties.map(p => `<span class="schema-tag property">${p}</span>`).join('')}</div>
      </div>`;
  }

  elements.schemaContent.innerHTML = html || '<div class="schema-loading">No schema data found</div>';
}

// Global function for onclick in schema tags
window.insertSchemaQuery = function (type, label) {
  if (type === 'vertex') {
    elements.queryEditor.value = `g.V().hasLabel('${label}').limit(25)`;
  } else {
    elements.queryEditor.value = `g.E().hasLabel('${label}').limit(25)`;
  }
};

// ===== Query Execution =====
elements.executeBtn.addEventListener('click', executeQuery);
elements.clearQueryBtn.addEventListener('click', () => {
  elements.queryEditor.value = '';
  elements.queryEditor.focus();
});

// Ctrl+Enter to execute
elements.queryEditor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    executeQuery();
  }
  // Tab key inserts spaces
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = elements.queryEditor.selectionStart;
    const end = elements.queryEditor.selectionEnd;
    elements.queryEditor.value = elements.queryEditor.value.substring(0, start) + '  ' + elements.queryEditor.value.substring(end);
    elements.queryEditor.selectionStart = elements.queryEditor.selectionEnd = start + 2;
  }
});

async function executeQuery() {
  const query = elements.queryEditor.value.trim();
  if (!query) {
    setStatus('Please enter a query', 'error');
    return;
  }

  if (!isConnected) {
    setStatus('Not connected to Neptune', 'error');
    return;
  }

  if (isExecuting) return;
  isExecuting = true;

  elements.executeBtn.disabled = true;
  setStatus('Executing query...');
  elements.resultsMeta.textContent = '';

  try {
    console.log('[renderer] Executing query:', query);
    const result = await window.neptune.executeQuery(query);
    console.log('result :::::::: RENDERERRRRRRRRRERRRRRR EREREREEREREREREERERE', JSON.stringify(result, null, 2));
    console.log('[renderer] Query result:', result);
    if (result.success) {
      currentResults = result.data;
      renderResults(result.data);
      elements.resultsMeta.innerHTML = `
        <span>⏱ ${result.duration}ms</span>
        <span>📊 ${result.count} result${result.count !== 1 ? 's' : ''}</span>
      `;
      elements.queryTime.textContent = `${result.duration}ms`;
      elements.resultCount.textContent = `${result.count} results`;
      setStatus(`Query executed successfully (${result.duration}ms)`);
      addToHistory(query, true);
    } else {
      showError(result.message);
      setStatus(result.message, 'error');
      addToHistory(query, false);
    }
  } catch (err) {
    showError(err.message);
    setStatus(err.message, 'error');
    addToHistory(query, false);
  }

  isExecuting = false;
  elements.executeBtn.disabled = false;
}

// ===== Results Rendering =====
function renderResults(data) {
  renderTable(data);
  renderJson(data);
  renderGraph(data); // async — auto-fetches missing vertex properties
}

function renderTable(data) {
  if (!data || data.length === 0) {
    elements.tableContainer.innerHTML = `
      <div class="empty-state-main">
        <h3>No results</h3>
        <p>The query returned no data</p>
      </div>`;
    return;
  }

  // Detect if data is simple values (strings, numbers, booleans)
  const isSimple = data.every(item => typeof item !== 'object' || item === null);

  if (isSimple) {
    let html = '<table class="results-table"><thead><tr><th>#</th><th>Value</th></tr></thead><tbody>';
    data.forEach((item, idx) => {
      const cellClass = typeof item === 'number' ? 'cell-number' : 'cell-string';
      html += `<tr><td class="cell-id">${idx + 1}</td><td class="${cellClass}">${escapeHtml(String(item))}</td></tr>`;
    });
    html += '</tbody></table>';
    elements.tableContainer.innerHTML = html;
    return;
  }

  // Complex objects — detect Neptune vertices/edges
  const isEdgeData = data.some(item => isNeptuneEdge(item));
  const isVertexData = data.some(item => isNeptuneVertex(item));

  if (isVertexData || isEdgeData) {
    renderNeptuneTable(data, isEdgeData);
  } else {
    renderGenericTable(data);
  }
}

function renderNeptuneTable(data, hasEdges) {
  // Collect all property keys across all items
  const propKeysSet = new Set();
  data.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const propsMap = neptunePropsToMap(item.properties);
    Object.keys(propsMap).forEach(k => propKeysSet.add(k));
  });

  const propKeys = Array.from(propKeysSet);

  let html = '<table class="results-table"><thead><tr>';
  html += '<th>#</th><th>ID</th><th>Label</th>';
  if (hasEdges) {
    html += '<th>From (outV)</th><th>To (inV)</th>';
  }
  propKeys.forEach(k => { html += `<th>${escapeHtml(k)}</th>`; });
  html += '</tr></thead><tbody>';

  data.forEach((item, idx) => {
    if (!item || typeof item !== 'object') {
      html += `<tr><td class="cell-id">${idx + 1}</td><td colspan="99">${escapeHtml(String(item))}</td></tr>`;
      return;
    }

    const propsMap = neptunePropsToMap(item.properties);
    const displayId = resolveId(item.id);
    const shortId = displayId.length > 20 ? displayId.substring(0, 20) + '…' : displayId;

    html += '<tr>';
    html += `<td class="cell-id">${idx + 1}</td>`;
    html += `<td class="cell-id" title="${escapeHtml(displayId)}">${escapeHtml(shortId)}</td>`;
    html += `<td class="cell-label">${escapeHtml(item.label || '')}</td>`;

    if (hasEdges) {
      if (item.outV && typeof item.outV === 'object') {
        html += `<td class="cell-string" title="${escapeHtml(item.outV.id || '')}">${escapeHtml(item.outV.label || '')} (${escapeHtml(String(item.outV.id || '').substring(0, 12))}…)</td>`;
      } else {
        html += `<td class="cell-string">${escapeHtml(String(item.outV || ''))}</td>`;
      }
      if (item.inV && typeof item.inV === 'object') {
        html += `<td class="cell-string" title="${escapeHtml(item.inV.id || '')}">${escapeHtml(item.inV.label || '')} (${escapeHtml(String(item.inV.id || '').substring(0, 12))}…)</td>`;
      } else {
        html += `<td class="cell-string">${escapeHtml(String(item.inV || ''))}</td>`;
      }
    }

    propKeys.forEach(k => {
      let value = propsMap[k];
      if (value === undefined || value === null) {
        html += '<td class="cell-string">—</td>';
      } else if (typeof value === 'boolean') {
        html += `<td class="cell-number">${value}</td>`;
      } else if (typeof value === 'number') {
        html += `<td class="cell-number">${value}</td>`;
      } else {
        const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
        const truncated = str.length > 60 ? str.substring(0, 60) + '…' : str;
        html += `<td class="cell-string" title="${escapeHtml(str)}">${escapeHtml(truncated)}</td>`;
      }
    });

    html += '</tr>';
  });

  html += '</tbody></table>';
  elements.tableContainer.innerHTML = html;
}

function renderGenericTable(data) {
  // Extract all keys
  const columns = new Set();
  data.forEach(item => {
    if (item && typeof item === 'object') {
      Object.keys(item).forEach(k => columns.add(k));
    }
  });

  const cols = Array.from(columns);

  let html = '<table class="results-table"><thead><tr><th>#</th>';
  cols.forEach(col => { html += `<th>${escapeHtml(col)}</th>`; });
  html += '</tr></thead><tbody>';

  data.forEach((item, idx) => {
    html += '<tr>';
    html += `<td class="cell-id">${idx + 1}</td>`;
    cols.forEach(col => {
      let value = item && item[col];
      if (value === undefined || value === null) {
        html += '<td>—</td>';
      } else if (typeof value === 'object') {
        const str = JSON.stringify(value);
        html += `<td class="cell-string" title="${escapeHtml(str)}">${escapeHtml(str.substring(0, 80))}</td>`;
      } else {
        const cellClass = typeof value === 'number' ? 'cell-number' : 'cell-string';
        html += `<td class="${cellClass}">${escapeHtml(String(value))}</td>`;
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  elements.tableContainer.innerHTML = html;
}

function renderJson(data) {
  const formatted = JSON.stringify(data, null, 2);
  elements.jsonOutput.textContent = formatted;
  highlightJson(elements.jsonOutput);
}

function highlightJson(el) {
  let html = el.textContent;
  // Simple JSON syntax highlighting
  html = html.replace(/"([^"]+)":/g, '<span style="color: var(--accent);">"$1"</span>:');
  html = html.replace(/: "([^"]*)"/g, ': <span style="color: var(--success);">"$1"</span>');
  html = html.replace(/: (\d+\.?\d*)/g, ': <span style="color: var(--orange);">$1</span>');
  html = html.replace(/: (true|false)/g, ': <span style="color: var(--purple);">$1</span>');
  html = html.replace(/: (null)/g, ': <span style="color: var(--text-muted);">$1</span>');
  el.innerHTML = html;
}

// ===== Graph Visualization =====
async function renderGraph(data) {
  if (!data || data.length === 0) {
    elements.graphCanvas.innerHTML = `
      <div class="empty-state-main">
        <h3>No graph data</h3>
        <p>Query returned no visualizable data</p>
      </div>`;
    return;
  }

  const nodes = new Map();
  const edges = [];
  const labelColors = {};
  const colorPalette = [
    '#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24',
    '#fb923c', '#2dd4bf', '#818cf8', '#e879f9', '#f87171',
  ];
  let colorIdx = 0;

  function getColorForLabel(label) {
    if (!labelColors[label]) {
      labelColors[label] = colorPalette[colorIdx % colorPalette.length];
      colorIdx++;
    }
    return labelColors[label];
  }

  function addNode(id, label, properties) {
    const propsMap = neptunePropsToMap(properties);

    if (nodes.has(id)) {
      // Merge: if the existing node has fewer properties, update it
      const existing = nodes.get(id);
      const existingPropCount = Object.keys(existing.properties).length;
      const newPropCount = Object.keys(propsMap).length;
      if (newPropCount > existingPropCount) {
        // Merge new properties into existing (new ones take priority)
        Object.assign(existing.properties, propsMap);
        // Re-compute display label with richer data
        existing.label = getDisplayLabel(label || existing.fullLabel, existing.properties, id);
        if (label) existing.fullLabel = label;
      } else if (existingPropCount === 0 && newPropCount === 0 && label && !existing.fullLabel) {
        existing.fullLabel = label;
        existing.label = getDisplayLabel(label, existing.properties, id);
      }
      return;
    }

    const displayLabel = getDisplayLabel(label, propsMap, id);
    nodes.set(id, {
      id,
      label: displayLabel,
      fullLabel: label,
      color: getColorForLabel(label),
      properties: propsMap,
    });
  }

  function extractGraphData(item) {
    if (!item || typeof item !== 'object') return;

    // Handle arrays (e.g. path results)
    if (Array.isArray(item)) {
      item.forEach(sub => extractGraphData(sub));
      return;
    }

    // Handle path objects
    if (item.labels !== undefined && item.objects !== undefined) {
      if (Array.isArray(item.objects)) {
        item.objects.forEach(obj => extractGraphData(obj));
      }
      return;
    }

    // Handle Neptune edges: has outV and inV
    if (isNeptuneEdge(item)) {
      const outV = item.outV;
      const inV = item.inV;

      // outV and inV are objects: {id: "...", label: "...", properties: [...]}
      const fromId = typeof outV === 'object' ? String(outV.id) : String(outV);
      const toId = typeof inV === 'object' ? String(inV.id) : String(inV);
      const fromLabel = typeof outV === 'object' ? (outV.label || 'unknown') : 'unknown';
      const toLabel = typeof inV === 'object' ? (inV.label || 'unknown') : 'unknown';
      const fromProps = typeof outV === 'object' ? outV.properties : [];
      const toProps = typeof inV === 'object' ? inV.properties : [];

      addNode(fromId, fromLabel, fromProps);
      addNode(toId, toLabel, toProps);

      const edgeId = resolveId(item.id);
      const edgePropsMap = neptunePropsToMap(item.properties);
      edges.push({
        from: fromId,
        to: toId,
        label: item.label || '',
        id: edgeId || `${fromId}-${toId}-${edges.length}`,
        properties: edgePropsMap,
        fromLabel: fromLabel,
        toLabel: toLabel,
      });
      return;
    }

    // Handle Neptune vertices: has id and label, no outV/inV
    if (isNeptuneVertex(item)) {
      const id = String(item.id);
      addNode(id, item.label, item.properties);
      return;
    }
  }

  data.forEach(item => extractGraphData(item));

  console.log(`[renderer] Graph: ${nodes.size} nodes, ${edges.length} edges`);

  // If no graph-able data, show message
  if (nodes.size === 0) {
    elements.graphCanvas.innerHTML = `
      <div class="empty-state-main">
        <h3>Non-graph results</h3>
        <p>The results don't contain vertex/edge data for visualization. Try queries like:<br>
        <code style="color: var(--accent);">g.V().limit(25)</code> or <code style="color: var(--accent);">g.V().outE().inV().path().limit(25)</code></p>
      </div>`;
    return;
  }

  // Auto-fetch full vertex properties for nodes that only have id/label (e.g. from edge queries)
  const nodesWithoutProps = [];
  nodes.forEach((node, id) => {
    if (Object.keys(node.properties).length === 0) {
      nodesWithoutProps.push(id);
    }
  });

  if (nodesWithoutProps.length > 0 && isConnected) {
    try {
      console.log(`[renderer] Auto-fetching properties for ${nodesWithoutProps.length} nodes...`);
      // Batch fetch in groups of 50 to avoid query size limits
      const batchSize = 50;
      for (let i = 0; i < nodesWithoutProps.length; i += batchSize) {
        const batch = nodesWithoutProps.slice(i, i + batchSize);
        const idsStr = batch.map(id => `'${id.replace(/'/g, "\\'")}'`).join(',');
        const result = await window.neptune.executeQuery(`g.V(${idsStr})`);
        if (result.success && result.data) {
          result.data.forEach(vertex => {
            if (!vertex || typeof vertex !== 'object') return;
            const vertexId = String(vertex.id);
            if (nodes.has(vertexId)) {
              const propsMap = neptunePropsToMap(vertex.properties);
              const existing = nodes.get(vertexId);
              Object.assign(existing.properties, propsMap);
              existing.label = getDisplayLabel(
                vertex.label || existing.fullLabel,
                existing.properties,
                vertexId
              );
              if (vertex.label) existing.fullLabel = vertex.label;
            }
          });
        }
      }
      console.log(`[renderer] Auto-fetch complete, enriched ${nodesWithoutProps.length} nodes`);
    } catch (e) {
      console.warn('[renderer] Could not auto-fetch vertex properties:', e);
    }
  }

  // Also auto-fetch full edge properties for edges that have no properties
  const edgesWithoutProps = edges.filter(e => Object.keys(e.properties).length === 0);
  if (edgesWithoutProps.length > 0 && isConnected) {
    try {
      console.log(`[renderer] Auto-fetching properties for ${edgesWithoutProps.length} edges...`);
      const batchSize = 50;
      for (let i = 0; i < edgesWithoutProps.length; i += batchSize) {
        const batch = edgesWithoutProps.slice(i, i + batchSize);
        const idsStr = batch.map(e => `'${e.id.replace(/'/g, "\\'")}'`).join(',');
        const result = await window.neptune.executeQuery(`g.E(${idsStr})`);
        if (result.success && result.data) {
          result.data.forEach(edgeData => {
            if (!edgeData || typeof edgeData !== 'object') return;
            const edgeId = resolveId(edgeData.id);
            const matchingEdge = edges.find(e => e.id === edgeId);
            if (matchingEdge) {
              const propsMap = neptunePropsToMap(edgeData.properties);
              Object.assign(matchingEdge.properties, propsMap);
            }
          });
        }
      }
      console.log(`[renderer] Edge auto-fetch complete`);
    } catch (e) {
      console.warn('[renderer] Could not auto-fetch edge properties:', e);
    }
  }

  drawGraphCanvas(nodes, edges);
}

function getDisplayLabel(vertexLabel, propsMap, id) {
  // Try common name properties
  const nameProps = ['name', 'title', 'displayName', 'username', 'email', 'entity_type', 'resource_type', 'block_type'];
  for (const prop of nameProps) {
    if (propsMap[prop] !== undefined && propsMap[prop] !== null && propsMap[prop] !== '') {
      const val = String(propsMap[prop]);
      if (val.length > 20) return val.substring(0, 20) + '…';
      return val;
    }
  }
  // Fallback to label + short id
  const shortId = String(id).substring(0, 8);
  return `${vertexLabel}\n${shortId}`;
}

function drawGraphCanvas(nodesMap, edgesList) {
  // Cleanup previous tooltip and detail panel if exists
  if (graphNetwork && graphNetwork.tooltip && graphNetwork.tooltip.parentNode) {
    graphNetwork.tooltip.parentNode.removeChild(graphNetwork.tooltip);
  }
  if (graphNetwork && graphNetwork.detailPanel && graphNetwork.detailPanel.parentNode) {
    graphNetwork.detailPanel.parentNode.removeChild(graphNetwork.detailPanel);
  }

  elements.graphCanvas.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  elements.graphCanvas.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let width, height;
  let scale = 1;
  let offsetX = 0, offsetY = 0;
  let dragging = false;
  let dragNode = null;
  let dragStartX, dragStartY;
  let hoveredNode = null;

  const nodeArray = [];
  const nodeMap = new Map();

  // Adjust node radius based on count
  const nodeCount = nodesMap.size;
  const baseRadius = nodeCount > 50 ? 16 : nodeCount > 20 ? 20 : 24;

  // Position nodes using circular initial layout
  let i = 0;
  nodesMap.forEach((node) => {
    const angle = (2 * Math.PI * i) / nodesMap.size;
    const layoutRadius = Math.min(400, Math.max(100, nodesMap.size * 20));
    const n = {
      ...node,
      x: Math.cos(angle) * layoutRadius + (Math.random() - 0.5) * 30,
      y: Math.sin(angle) * layoutRadius + (Math.random() - 0.5) * 30,
      vx: 0,
      vy: 0,
      radius: baseRadius,
    };
    nodeArray.push(n);
    nodeMap.set(n.id, n);
    i++;
  });

  // Force simulation
  function simulate() {
    const iterations = Math.min(200, Math.max(50, 300 - nodeCount));
    const repulsionStrength = nodeCount > 50 ? 8000 : 5000;
    const springLength = nodeCount > 50 ? 200 : 150;

    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between all nodes (Barnes-Hut simplified: skip far pairs for large graphs)
      for (let a = 0; a < nodeArray.length; a++) {
        for (let b = a + 1; b < nodeArray.length; b++) {
          const dx = nodeArray[b].x - nodeArray[a].x;
          const dy = nodeArray[b].y - nodeArray[a].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = repulsionStrength / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodeArray[a].vx -= fx;
          nodeArray[a].vy -= fy;
          nodeArray[b].vx += fx;
          nodeArray[b].vy += fy;
        }
      }

      // Attraction along edges
      edgesList.forEach(edge => {
        const from = nodeMap.get(edge.from);
        const to = nodeMap.get(edge.to);
        if (from && to) {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = (dist - springLength) * 0.01;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          from.vx += fx;
          from.vy += fy;
          to.vx -= fx;
          to.vy -= fy;
        }
      });

      // Center gravity
      nodeArray.forEach(node => {
        node.vx -= node.x * 0.002;
        node.vy -= node.y * 0.002;
      });

      // Apply velocities with damping
      const damping = 0.8;
      nodeArray.forEach(node => {
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;
      });
    }
  }

  simulate();

  // Auto-fit: compute bounding box and set initial zoom
  function autoFit() {
    if (nodeArray.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodeArray.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    });
    const graphWidth = maxX - minX + 100;
    const graphHeight = maxY - minY + 100;
    const scaleX = (width - 80) / graphWidth;
    const scaleY = (height - 80) / graphHeight;
    scale = Math.min(scaleX, scaleY, 2);
    scale = Math.max(scale, 0.1);
    offsetX = 0;
    offsetY = 0;
    // Center the graph
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    nodeArray.forEach(n => {
      n.x -= cx;
      n.y -= cy;
    });
  }

  function resize() {
    const rect = elements.graphCanvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
    ctx.scale(scale, scale);

    // Draw edges
    edgesList.forEach(edge => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (from && to) {
        const isEdgeHovered = hoveredEdge === edge;
        const isPinned = pinnedItem && pinnedItem.type === 'edge' && pinnedItem.data === edge;
        const isHighlighted = isEdgeHovered || isPinned;

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = isHighlighted ? '#a78bfa' : 'rgba(100, 116, 139, 0.4)';
        ctx.lineWidth = isHighlighted ? 2.5 : 1.2;
        ctx.stroke();

        // Arrow
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowDist = to.radius + 4;
        const ax = to.x - Math.cos(angle) * arrowDist;
        const ay = to.y - Math.sin(angle) * arrowDist;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 8 * Math.cos(angle - 0.3), ay - 8 * Math.sin(angle - 0.3));
        ctx.lineTo(ax - 8 * Math.cos(angle + 0.3), ay - 8 * Math.sin(angle + 0.3));
        ctx.closePath();
        ctx.fillStyle = isHighlighted ? '#a78bfa' : 'rgba(100, 116, 139, 0.6)';
        ctx.fill();

        // Edge label (only show if zoomed in enough)
        if (edge.label && scale > 0.5) {
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          ctx.font = `${Math.max(8, 10 / scale * 0.8)}px Inter, sans-serif`;
          ctx.fillStyle = '#64748b';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Background for readability
          const textWidth = ctx.measureText(edge.label).width;
          ctx.fillStyle = isHighlighted ? 'rgba(167, 139, 250, 0.3)' : 'rgba(15, 23, 42, 0.8)';
          ctx.fillRect(mx - textWidth / 2 - 3, my - 8, textWidth + 6, 14);
          ctx.fillStyle = isHighlighted ? '#e2d9ff' : '#94a3b8';
          ctx.fillText(edge.label, mx, my - 1);
        }
      }
    });

    // Draw nodes
    nodeArray.forEach(node => {
      const isHovered = hoveredNode === node;
      const r = isHovered ? node.radius + 3 : node.radius;

      // Glow for hovered
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = node.color + '33';
        ctx.fill();
      }

      // Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r);
      gradient.addColorStop(0, node.color + 'ee');
      gradient.addColorStop(1, node.color + '99');
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = isHovered ? '#ffffff' : node.color;
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.stroke();

      // Label (only show if zoomed in enough or few nodes)
      if (scale > 0.3 || nodeCount < 30) {
        ctx.font = `bold ${Math.max(9, 11)}px Inter, sans-serif`;
        ctx.fillStyle = '#f1f5f9';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lines = node.label.split('\n');
        lines.forEach((line, li) => {
          // Text shadow for readability
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
          ctx.lineWidth = 3;
          ctx.strokeText(line, node.x, node.y + (li - (lines.length - 1) / 2) * 13);
          ctx.fillText(line, node.x, node.y + (li - (lines.length - 1) / 2) * 13);
        });
      }
    });

    ctx.restore();
    requestAnimationFrame(draw);
  }

  function getNodeAt(mx, my) {
    const cx = (mx - width / 2 - offsetX) / scale;
    const cy = (my - height / 2 - offsetY) / scale;
    for (let i = nodeArray.length - 1; i >= 0; i--) {
      const n = nodeArray[i];
      const dx = cx - n.x;
      const dy = cy - n.y;
      if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) {
        return n;
      }
    }
    return null;
  }

  function getEdgeAt(mx, my) {
    const cx = (mx - width / 2 - offsetX) / scale;
    const cy = (my - height / 2 - offsetY) / scale;
    const threshold = Math.max(6, 8 / scale);
    for (let i = edgesList.length - 1; i >= 0; i--) {
      const edge = edgesList[i];
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) continue;
      // Point-to-line-segment distance
      const ax = from.x, ay = from.y, bx = to.x, by = to.y;
      const abx = bx - ax, aby = by - ay;
      const acx = cx - ax, acy = cy - ay;
      const abLen2 = abx * abx + aby * aby;
      if (abLen2 === 0) continue;
      let t = (acx * abx + acy * aby) / abLen2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * abx;
      const py = ay + t * aby;
      const dx = cx - px, dy = cy - py;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        return edge;
      }
    }
    return null;
  }

  let hoveredEdge = null;
  let pinnedItem = null; // {type: 'node'|'edge', data: ...}

  // Interaction
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = getNodeAt(mx, my);
    if (node) {
      dragNode = node;
      dragStartX = mx;
      dragStartY = my;
    } else {
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragNode) {
      dragNode.x += (mx - dragStartX) / scale;
      dragNode.y += (my - dragStartY) / scale;
      dragStartX = mx;
      dragStartY = my;
    } else if (dragging) {
      offsetX += e.clientX - dragStartX;
      offsetY += e.clientY - dragStartY;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    } else {
      hoveredNode = getNodeAt(mx, my);
      hoveredEdge = hoveredNode ? null : getEdgeAt(mx, my);
      canvas.style.cursor = (hoveredNode || hoveredEdge) ? 'pointer' : 'default';
    }
  });

  canvas.addEventListener('mouseup', () => {
    dragNode = null;
    dragging = false;
  });

  // Click to pin detail panel
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = getNodeAt(mx, my);
    if (node) {
      pinnedItem = { type: 'node', data: node };
      renderDetailPanel(pinnedItem);
      return;
    }
    const edge = getEdgeAt(mx, my);
    if (edge) {
      pinnedItem = { type: 'edge', data: edge };
      renderDetailPanel(pinnedItem);
      return;
    }
    // Click on empty space - close panel
    if (pinnedItem) {
      pinnedItem = null;
      hideDetailPanel();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    scale *= zoomFactor;
    scale = Math.max(0.05, Math.min(5, scale));
  }, { passive: false });

  // Graph controls
  elements.graphFitBtn.onclick = () => {
    autoFit();
  };

  elements.graphZoomInBtn.onclick = () => {
    scale = Math.min(5, scale * 1.3);
  };

  elements.graphZoomOutBtn.onclick = () => {
    scale = Math.max(0.05, scale / 1.3);
  };

  // Tooltip (hover)
  const tooltip = document.createElement('div');
  tooltip.className = 'node-tooltip';
  document.body.appendChild(tooltip);

  // Detail panel (click-pinned, shows full data)
  let detailPanel = document.createElement('div');
  detailPanel.className = 'graph-detail-panel';
  detailPanel.style.display = 'none';
  elements.graphCanvas.parentElement.appendChild(detailPanel);

  function renderDetailPanel(item) {
    let html = '<div class="detail-panel-header">';
    if (item.type === 'node') {
      const node = item.data;
      html += `<span class="detail-type-badge detail-type-node">VERTEX</span>`;
      html += `<button class="detail-close-btn" title="Close">&times;</button>`;
      html += '</div>';
      html += `<h4>${escapeHtml(node.fullLabel)}</h4>`;
      html += `<div class="detail-row"><span class="detail-key">ID</span><span class="detail-value">${escapeHtml(node.id)}</span></div>`;
      html += `<div class="detail-row"><span class="detail-key">Label</span><span class="detail-value">${escapeHtml(node.fullLabel)}</span></div>`;
      const props = node.properties;
      if (props && typeof props === 'object' && Object.keys(props).length > 0) {
        html += '<div class="detail-section-title">Properties</div>';
        Object.entries(props).forEach(([key, val]) => {
          const display = (val === null || val === undefined) ? '—' : String(val);
          html += `<div class="detail-row"><span class="detail-key">${escapeHtml(key)}</span><span class="detail-value">${escapeHtml(display)}</span></div>`;
        });
      }
    } else if (item.type === 'edge') {
      const edge = item.data;
      html += `<span class="detail-type-badge detail-type-edge">EDGE</span>`;
      html += `<button class="detail-close-btn" title="Close">&times;</button>`;
      html += '</div>';
      html += `<h4>${escapeHtml(edge.label || 'Edge')}</h4>`;
      html += `<div class="detail-row"><span class="detail-key">ID</span><span class="detail-value">${escapeHtml(edge.id)}</span></div>`;
      html += `<div class="detail-row"><span class="detail-key">Label</span><span class="detail-value">${escapeHtml(edge.label || '')}</span></div>`;
      html += `<div class="detail-row"><span class="detail-key">From</span><span class="detail-value">${escapeHtml(edge.fromLabel || '')} (${escapeHtml(edge.from)})</span></div>`;
      html += `<div class="detail-row"><span class="detail-key">To</span><span class="detail-value">${escapeHtml(edge.toLabel || '')} (${escapeHtml(edge.to)})</span></div>`;
      const props = edge.properties;
      if (props && typeof props === 'object' && Object.keys(props).length > 0) {
        html += '<div class="detail-section-title">Properties</div>';
        Object.entries(props).forEach(([key, val]) => {
          const display = (val === null || val === undefined) ? '—' : String(val);
          html += `<div class="detail-row"><span class="detail-key">${escapeHtml(key)}</span><span class="detail-value">${escapeHtml(display)}</span></div>`;
        });
      }
    }
    detailPanel.innerHTML = html;
    detailPanel.style.display = 'block';

    // Close button
    const closeBtn = detailPanel.querySelector('.detail-close-btn');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        pinnedItem = null;
        hideDetailPanel();
      };
    }
  }

  function hideDetailPanel() {
    detailPanel.style.display = 'none';
  }

  canvas.addEventListener('mousemove', (e) => {
    // Don't show hover tooltip if detail panel is pinned
    if (pinnedItem) {
      tooltip.style.display = 'none';
      return;
    }
    if (hoveredNode) {
      let html = `<h4>${escapeHtml(hoveredNode.fullLabel)}</h4>`;
      html += `<div class="tooltip-row"><span class="tooltip-key">ID</span><span class="tooltip-value">${escapeHtml(hoveredNode.id)}</span></div>`;
      const props = hoveredNode.properties;
      if (props && typeof props === 'object') {
        Object.entries(props).forEach(([key, val]) => {
          const display = (val === null || val === undefined) ? '—' : String(val);
          html += `<div class="tooltip-row"><span class="tooltip-key">${escapeHtml(key)}</span><span class="tooltip-value">${escapeHtml(display)}</span></div>`;
        });
      }
      html += `<div class="tooltip-hint">Click to see full details</div>`;
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 16) + 'px';
      tooltip.style.top = (e.clientY + 16) + 'px';
    } else if (hoveredEdge) {
      let html = `<h4>${escapeHtml(hoveredEdge.label || 'Edge')}</h4>`;
      html += `<div class="tooltip-row"><span class="tooltip-key">ID</span><span class="tooltip-value">${escapeHtml(hoveredEdge.id)}</span></div>`;
      html += `<div class="tooltip-row"><span class="tooltip-key">From</span><span class="tooltip-value">${escapeHtml(hoveredEdge.fromLabel || '')} → ${escapeHtml(hoveredEdge.toLabel || '')}</span></div>`;
      const props = hoveredEdge.properties;
      if (props && typeof props === 'object') {
        Object.entries(props).forEach(([key, val]) => {
          const display = (val === null || val === undefined) ? '—' : String(val);
          html += `<div class="tooltip-row"><span class="tooltip-key">${escapeHtml(key)}</span><span class="tooltip-value">${escapeHtml(display)}</span></div>`;
        });
      }
      html += `<div class="tooltip-hint">Click to see full details</div>`;
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 16) + 'px';
      tooltip.style.top = (e.clientY + 16) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

  resize();
  autoFit();
  window.addEventListener('resize', resize);
  draw();

  // Store network ref for cleanup
  graphNetwork = { canvas, resize, tooltip, detailPanel };
}

// ===== Tabs =====
elements.tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    elements.tabBtns.forEach(b => b.classList.remove('active'));
    elements.tabContents.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.tab}Tab`).classList.add('active');

    // Resize graph canvas when switching to graph tab
    if (btn.dataset.tab === 'graph' && graphNetwork) {
      setTimeout(() => graphNetwork.resize(), 50);
    }
  });
});

// ===== Quick Queries =====
document.querySelectorAll('.quick-query-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    elements.queryEditor.value = btn.dataset.query;
    elements.queryEditor.focus();
  });
});

// ===== Query History =====
function addToHistory(query, success) {
  const timestamp = new Date().toLocaleTimeString();
  queryHistoryList.unshift({ query, success, timestamp });
  if (queryHistoryList.length > 50) queryHistoryList.pop();
  renderHistory();
}

function renderHistory() {
  if (queryHistoryList.length === 0) {
    elements.queryHistory.innerHTML = '<div class="empty-state">No queries yet</div>';
    return;
  }

  elements.queryHistory.innerHTML = queryHistoryList.map(item => `
    <div class="history-item ${item.success ? 'success' : 'error'}" onclick="loadHistoryQuery(this)" data-query="${escapeHtml(item.query)}">
      <span class="history-query">${escapeHtml(item.query)}</span>
      <span class="history-time">${item.timestamp}</span>
    </div>
  `).join('');
}

window.loadHistoryQuery = function (el) {
  elements.queryEditor.value = el.dataset.query;
  elements.queryEditor.focus();
};

// ===== Error Display =====
function showError(message) {
  elements.tableContainer.innerHTML = `<div class="error-message">❌ ${escapeHtml(message)}</div>`;
  elements.jsonOutput.textContent = JSON.stringify({ error: message }, null, 2);
  elements.graphCanvas.innerHTML = '';
}

// ===== Status Bar =====
function setStatus(message, type) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.style.color = type === 'error' ? 'var(--danger)' : 'var(--text-muted)';
}

// ===== Utility =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
