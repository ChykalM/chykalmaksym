// ─────────────────────────────────────────────
//  Figma Sitemap Generator — Plugin Backend
// ─────────────────────────────────────────────

figma.showUI(__html__, { width: 320, height: 400, title: 'Sitemap Generator' });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'generate') {
    try {
      await generateSitemap(msg.depth, msg.cardWidth);
    } catch (e) {
      figma.notify('Error: ' + e.message, { error: true });
      figma.closePlugin();
    }
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

// ─── Constants ────────────────────────────────
const CARD_H  = 56;
const H_GAP   = 28;   // horizontal gap between siblings
const V_GAP   = 72;   // vertical gap between levels
const RADIUS  = 8;    // card corner radius
const PADDING = 16;   // sitemap outer padding

// ─── Level Styles (level 0 = root, 1 = page, 2 = frame, 3+ = sub-frame)
const STYLES = [
  { bg: [0.071, 0.063, 0.169], text: [1, 1, 1],   font: 'SemiBold', size: 14 },
  { bg: [0.235, 0.424, 0.965], text: [1, 1, 1],   font: 'SemiBold', size: 13 },
  { bg: [1, 1, 1], text: [0.118, 0.118, 0.196],   font: 'Regular',  size: 12,
    border: [0.820, 0.835, 0.910] },
  { bg: [0.961, 0.961, 1.000], text: [0.345, 0.345, 0.494], font: 'Regular', size: 12,
    border: [0.820, 0.835, 0.910] },
];

function rgb([r, g, b]) { return { r, g, b }; }

// ─── Build Tree from Figma File ───────────────
function buildTree(maxDepth) {
  function frameNode(f, level) {
    const node = { name: f.name, level, children: [] };
    if (level < maxDepth) {
      for (const c of f.children) {
        if (c.type === 'FRAME') node.children.push(frameNode(c, level + 1));
      }
    }
    return node;
  }

  const root = { name: figma.root.name, level: 0, children: [] };

  for (const page of figma.root.children) {
    if (page.name === '\uD83D\uDDFA Sitemap') continue; // skip existing sitemap page
    const pNode = { name: page.name, level: 1, children: [] };
    if (maxDepth >= 2) {
      for (const c of page.children) {
        if (c.type === 'FRAME') pNode.children.push(frameNode(c, 2));
      }
    }
    root.children.push(pNode);
  }

  return root;
}

// ─── Tree Layout ──────────────────────────────
function subtreeWidth(node, cardW) {
  if (!node.children.length) return cardW;
  const childrenW = node.children.reduce((s, c) => s + subtreeWidth(c, cardW), 0)
    + H_GAP * (node.children.length - 1);
  return Math.max(cardW, childrenW);
}

function layoutTree(node, x, y, cardW) {
  node.x = x;
  node.y = y;
  if (!node.children.length) return;

  const totalW = node.children.reduce((s, c) => s + subtreeWidth(c, cardW), 0)
    + H_GAP * (node.children.length - 1);
  let cx = x + cardW / 2 - totalW / 2;
  const childY = y + CARD_H + V_GAP;

  for (const child of node.children) {
    const sw = subtreeWidth(child, cardW);
    layoutTree(child, cx, childY, cardW);
    cx += sw + H_GAP;
  }
}

function* allNodes(node) {
  yield node;
  for (const c of node.children) yield* allNodes(c);
}

// ─── Card Drawing ─────────────────────────────
function drawCard(node, cardW) {
  const style = STYLES[Math.min(node.level, STYLES.length - 1)];

  const frame = figma.createFrame();
  frame.name = node.name;
  frame.x = node.x;
  frame.y = node.y;
  frame.resize(cardW, CARD_H);
  frame.cornerRadius = RADIUS;
  frame.fills = [{ type: 'SOLID', color: rgb(style.bg) }];
  frame.clipsContent = true;

  if (style.border) {
    frame.strokes = [{ type: 'SOLID', color: rgb(style.border) }];
    frame.strokeWeight = 1;
    frame.strokeAlign = 'INSIDE';
  }

  // Top accent bar for level 2+
  if (node.level >= 2) {
    const bar = figma.createRectangle();
    bar.resize(cardW, 3);
    bar.x = 0;
    bar.y = 0;
    bar.fills = [{ type: 'SOLID', color: rgb(STYLES[1].bg) }];
    frame.appendChild(bar);
  }

  const label = figma.createText();
  label.fontName = { family: 'Inter', style: style.font };
  label.fontSize = style.size;
  label.characters = node.name;
  label.fills = [{ type: 'SOLID', color: rgb(style.text) }];
  label.textAlignHorizontal = 'CENTER';
  label.textAlignVertical = 'CENTER';
  label.textAutoResize = 'TRUNCATE';
  label.resize(cardW - 24, CARD_H);
  label.x = 12;
  label.y = 0;
  frame.appendChild(label);

  return frame;
}

// ─── Connector Drawing ────────────────────────
function drawConnector(parent, child, cardW) {
  const x1 = parent.x + cardW / 2;
  const y1 = parent.y + CARD_H;
  const x2 = child.x + cardW / 2;
  const y2 = child.y;
  const midY = Math.round((y1 + y2) / 2);

  const data = x1 === x2
    ? `M ${x1} ${y1} L ${x2} ${y2}`
    : `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;

  const vector = figma.createVector();
  vector.vectorPaths = [{ windingRule: 'NONZERO', data }];
  vector.fills = [];
  vector.strokes = [{ type: 'SOLID', color: { r: 0.78, g: 0.80, b: 0.88 } }];
  vector.strokeWeight = 1.5;
  vector.strokeCap = 'ROUND';
  vector.strokeJoin = 'ROUND';
  vector.name = `${parent.name} → ${child.name}`;

  return vector;
}

// ─── Main Generator ───────────────────────────
async function generateSitemap(maxDepth, cardW) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'SemiBold' });

  const tree = buildTree(maxDepth);

  if (!tree.children.length) {
    figma.notify('No pages found to map.', { error: true });
    figma.closePlugin();
    return;
  }

  layoutTree(tree, 0, 0, cardW);

  // Get or create the sitemap page
  let sPage = figma.root.children.find(p => p.name === '\uD83D\uDDFA Sitemap');
  if (!sPage) {
    sPage = figma.createPage();
    sPage.name = '\uD83D\uDDFA Sitemap';
    figma.root.insertChild(0, sPage);
  } else {
    [...sPage.children].forEach(c => c.remove());
  }
  figma.currentPage = sPage;

  const elements = [];

  // Draw connectors first (behind cards)
  for (const node of allNodes(tree)) {
    for (const child of node.children) {
      elements.push(drawConnector(node, child, cardW));
    }
  }

  // Draw cards on top
  for (const node of allNodes(tree)) {
    elements.push(drawCard(node, cardW));
  }

  figma.viewport.scrollAndZoomIntoView(elements);
  figma.notify('\u2705 Sitemap generated!');
  figma.closePlugin();
}
