#!/usr/bin/env python3
# 仅用标准库解析 .docx（本质是 zip + XML），抽取正文与表格文本到 .txt
# 不修改任何原文件，仅做只读抽取。
import zipfile, re, os, sys
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def para_text(p):
    # 拼接段落内所有 w:t 文本
    parts = []
    for t in p.iter(W + 't'):
        parts.append(t.text or '')
    return ''.join(parts)

def block_to_text(block):
    # 处理段落与表格混排，返回文本行列表
    lines = []
    # 直接子节点按顺序处理
    for child in block:
        tag = child.tag
        if tag == W + 'p':
            lines.append(para_text(child))
        elif tag == W + 'tbl':
            lines.append('[TABLE START]')
            for tr in child.iter(W + 'tr'):
                cells = []
                for tc in tr.findall(W + 'tc'):
                    # 单元格内可能有多个段落
                    cell_text = ' '.join(para_text(p) for p in tc.findall(W + 'p'))
                    cells.append(cell_text)
                lines.append('\t|'.join(cells))
            lines.append('[TABLE END]')
    return lines

def extract(path):
    out = []
    with zipfile.ZipFile(path) as z:
        # 主文档
        xml = z.read('word/document.xml')
        root = ET.fromstring(xml)
        body = root.find(W + 'body')
        for line in block_to_text(body):
            out.append(line)
        # 页眉页脚（可能含答案/题号说明）
        for name in z.namelist():
            if re.match(r'word/(header|footer)\d*\.xml$', name):
                try:
                    hx = ET.fromstring(z.read(name))
                    for line in block_to_text(hx):
                        if line.strip():
                            out.append('[H/F] ' + line)
                except Exception:
                    pass
    return '\n'.join(out)

if __name__ == '__main__':
    files = sys.argv[1:]
    os.makedirs('extracted', exist_ok=True)
    for f in files:
        base = os.path.splitext(os.path.basename(f))[0]
        txt = extract(f)
        outp = os.path.join('extracted', base + '.txt')
        with open(outp, 'w', encoding='utf-8') as fh:
            fh.write(txt)
        print(f'{base}: {len(txt)} chars -> {outp}')
