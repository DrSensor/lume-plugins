class Title {
  accessor size = getComputedStyle(document.body).fontSize
  #text = ""
  get text() { return this.#text }
  constructor(text) { this.#text = text.data }
}

const titles = []
for (const h1 of document.getElementsByTagName("h1")) {
  const title = new Title(h1.firstChild)
  title.size = getComputedStyle(h1).fontSize
  titles.push(title)
}
console.debug(titles)
