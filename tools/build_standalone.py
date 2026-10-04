import base64

def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

html = read("index.html")
css = read("styles.css")
app = read("app.js")
cover = read("assets/cover.svg")
cover_data = "data:image/svg+xml;base64," + base64.b64encode(cover.encode("utf-8")).decode("ascii")

html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>", 1)
html = html.replace('src="assets/cover.svg"', 'src="' + cover_data + '"', 1)
html = html.replace('<script src="app.js"></script>', "<script>\n" + app + "\n</script>", 1)

with open("huixin-web-standalone.html", "w", encoding="utf-8") as f:
    f.write(html)

leftovers = [x for x in ["styles.css", "app.js", "assets/cover.svg"] if ('"' + x + '"') in html]
print("size KB:", round(len(html.encode("utf-8")) / 1024, 1))
print("leftovers:", leftovers if leftovers else "none")
