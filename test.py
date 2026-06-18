import re
html=open('public/index.html', encoding='utf-8').read()
js=open('public/app.js', encoding='utf-8', errors='ignore').read()
ids=re.findall(r"getElementById\('([^']+)'\)", js)
missing=[i for i in ids if not re.search(r'id=[\"']' + i + r'[\"']', html)]
print('\n'.join(set(missing)))
