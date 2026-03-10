import re
from pathlib import Path

BASE_DIR = Path("C:/Users/user/Desktop/lectureteller/static")
index_html = BASE_DIR / "index.html"
style_css = BASE_DIR / "style.css"
main_js = BASE_DIR / "main.js"

content = index_html.read_text(encoding="utf-8")

# Extract CSS
style_match = re.search(r"<style>(.*?)</style>", content, flags=re.DOTALL)
if style_match:
    css_content = style_match.group(1).strip()
    style_css.write_text(css_content, encoding="utf-8")
    content = content.replace(style_match.group(0), '<link rel="stylesheet" href="/style.css">')

# Extract JS
script_match = re.search(r"<script>(.*?)</script>", content, flags=re.DOTALL)
if script_match:
    js_content = script_match.group(1).strip()
    main_js.write_text(js_content, encoding="utf-8")
    content = content.replace(script_match.group(0), '<script src="/main.js"></script>')

index_html.write_text(content, encoding="utf-8")
print("Successfully split index.html into style.css and main.js")
