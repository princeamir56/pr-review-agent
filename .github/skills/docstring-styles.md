# Skill: docstring-styles

Language-aware docstring templates the Documentation agent uses when suggesting missing
or incomplete function/class documentation.

## Selection rule

- `.js` / `.ts` / `.jsx` / `.tsx` / `.mjs` / `.cjs` → **JSDoc / TSDoc**
- `.py` → **Google style**
- `.java` → **Javadoc**
- Other → describe in plain English; do not invent a style.

## JSDoc / TSDoc

```js
/**
 * One-line summary in imperative mood.
 *
 * Optional second paragraph if the summary needs it. Keep total ≤ 4 lines.
 *
 * @param {string} name - What this argument represents.
 * @param {number} [count=1] - Optional argument with default.
 * @returns {Promise<User>} What the caller gets back.
 * @throws {NotFoundError} When the record is missing.
 */
```

Rules: no `@param` for arguments TypeScript already types; omit `{type}` in TSDoc files.

## Python — Google style

```python
def load_user(user_id: str) -> User:
    """Load a user record by id.

    Args:
        user_id: The GitHub-style login, not the numeric id.

    Returns:
        The materialized User model.

    Raises:
        NotFoundError: If no user with that id exists.
    """
```

Rules: one-line summary on the same line as `"""`, blank line before sections, sections
in order: `Args`, `Returns`, `Raises`, `Yields`, `Example`.

## Javadoc

```java
/**
 * One-line summary in imperative mood.
 *
 * @param name what this argument represents
 * @return what the caller gets back
 * @throws NotFoundException when the record is missing
 */
```

## Rules that apply everywhere

- **Imperative mood** for the summary: *"Load a user"*, not *"Loads a user"* or *"This
  method loads…"*.
- Never document what the reader can see from the signature.
- Never write *"TODO: add description"* — either write the description or say nothing.
- Do not fabricate `@throws` — only list exceptions actually raised in the body.
- Keep summaries ≤ 100 chars so IDE hover tooltips render cleanly.
