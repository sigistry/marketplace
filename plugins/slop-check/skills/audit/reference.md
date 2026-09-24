# slop-check reference

The full catalog of AI-slop tells, with examples and rewrites. Grounded in [Wikipedia's "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) plus current editorial guidance. Use it to explain a finding or when you need the exhaustive list. The governing rule still holds: weigh clusters and register, not lone hits.

## 1. Cliché vocabulary

Overused words that spike in AI text. One is nothing; a handful in a paragraph is a signal.

`delve`, `leverage`, `tapestry`, `robust`, `seamless`, `pivotal`, `underscore`, `realm`, `vibrant`, `boasts`, `nestled`, `testament`, `foster`, `garner`, `intricate`, `meticulous`, `showcase`, `bolster`, `enduring`, `interplay`, `landscape` (figurative), `navigate` (figurative), `utilize`, `facilitate`, `myriad`, `crucial`, `vital`.

- Before: "This robust framework lets teams seamlessly navigate the evolving landscape."
- After: "This framework lets teams handle changing requirements."

## 2. Stock phrases and filler

Canned openers and connectors that add words, not meaning.

"it is important to note," "in today's fast-paced world," "when it comes to," "plays a crucial role," "a rich tapestry of," "at the end of the day," "needless to say," "in the realm of," "the world of."

- Before: "It is important to note that, when it comes to performance, caching plays a crucial role."
- After: "Caching is the main lever for performance here."

## 3. Structure and sentence patterns

### Negative parallelisms
"not just X, but Y," "it's not X, it's Y," "no X, no Y, just Z." These pose as insight while correcting a belief the reader never held.

- Before: "It's not just a database, it's a way of thinking about data."
- After: "It stores data, and its query model shapes how you design schemas."

### Copula avoidance
"serves as," "stands as," "functions as," "acts as," "represents" replacing a plain "is" or "are."

- Before: "The README serves as the entry point for new users."
- After: "The README is the entry point for new users."

### Rule-of-three padding
Three adjectives or clauses where one carries the load, repeated across the piece.

- Before: "a clean, elegant, and intuitive interface"
- After: "a clean interface" (pick the word that is true)

### Formulaic outline
The rigid intro, three balanced points, tidy conclusion, plus "Despite its strengths, X faces challenges" and end-of-section recaps that restate what was just said. Vary the shape. Cut the recap.

## 4. Register and tone

### Promotional language
Travel-brochure adjectives and unearned significance: "vibrant," "nestled," "groundbreaking," "renowned," "a testament to," "underscores its importance," "in the heart of."

- Before: "Nestled in a vibrant ecosystem, this groundbreaking tool is a testament to modern design."
- After: "This tool does X. It fits the Y ecosystem."

### Over-hedging
"could potentially," "may benefit," "aims to," "has the potential to," vague futures with no evidence. State what is, or attribute the claim.

### Vague authority (weasel wording)
"experts argue," "studies show," "industry reports," "it is widely regarded" with nothing cited. Name the source or drop the claim.

## 5. Punctuation and formatting

- **Em dashes** substituting for commas, colons, or periods, several per section. A well-placed dash is fine; a pileup is a tell. Strict house style: no spaced em dashes at all.
- **Decorative emoji**, especially as bullets or section markers, or the reflexive rocket and sparkles. Cut them from technical prose.
- **Boldface on every other phrase.** Bold is for the rare word that must not be missed.
- **Title Case On Ordinary Headings.** Use sentence case.
- **Divider lines between every section.** Let headings do that work.
- **Smart quotes and apostrophes** where the surrounding text and tooling expect ASCII (code, terminals, plain Markdown).

## 6. Rhythm

AI prose tends toward uniform sentence length and shape. Human writing varies it. Read a passage aloud in your head. If every sentence has the same length and cadence, break the pattern: a short sentence after two long ones resets the ear.

## 7. LLM leftovers

Direct evidence a chatbot wrote it. Always remove.

"As an AI," "as of my knowledge cutoff," "I hope this helps," "certainly! Here is," prompt refusals left in text, `[Insert X here]` placeholders, and citation fragments from chat interfaces: `oaicite`, `oai_citation`, `contentReference`, `[cite: 1]`, `turn0search0`.

## 8. What not to flag

These are noise on their own. Do not raise them without a cluster or clear context.

- A single cliché word used once.
- One em dash, or one emoji, used well.
- Marketing tone in a piece that is meant to sell.
- The presence of citations (fabricated ones look real too, so verify rather than trust).
- Any AI-detector score. Ignore these outright.
