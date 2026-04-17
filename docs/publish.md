# Flujo de Publicación Automática

Este repositorio utiliza **`semantic-release`** para automatizar el versionado, la creación de changelogs, tags en Git, publicaciones en **npm** y **GitHub Releases**.

## Cómo funciona

El flujo se dispara automáticamente en cada **push a `main`**. El sistema analiza los mensajes de los commits desde la última release para decidir qué tipo de versión toca (Patch, Minor o Major).

### Importante: Mensajes de Commit (Conventional Commits)

Para que se genere una release, **debes usar commits convencionales**. Si el commit no sigue este formato, GitHub Actions terminará con éxito pero **no publicará nada**.

| Prefijo | Ejemplo | Tipo de Release |
| :--- | :--- | :--- |
| `fix:` | `fix: corrige error en fallback` | **Patch** (1.1.0 -> 1.1.1) |
| `feat:` | `feat: agrega soporte para X` | **Minor** (1.1.0 -> 1.2.0) |
| `feat!:` o `BREAKING CHANGE:` | `feat!: cambia la API de perfiles` | **Major** (1.1.0 -> 2.0.0) |

> Commits con prefijos como `ci:`, `docs:`, `test:`, `chore:`, etc., **no disparan releases** por sí solos, pero se incluirán en el changelog de la siguiente release.

## Requisitos del Entorno

El workflow de GitHub Actions (`.github/workflows/publish.yml`) requiere:
- **Node.js >= 22.14.0** (configurado en el workflow).
- **Secrets**:
  - `NPM_TOKEN`: Token de npm con permisos de publicación.
  - `GITHUB_TOKEN`: Provisto automáticamente por GitHub Actions.

## Pasos para Publicar

1. Realiza tus cambios en una rama o directamente en `main`.
2. Realiza el commit usando el prefijo adecuado (ej: `fix:`).
3. Haz push a `main`:
   ```bash
   git push origin main
   ```
4. El resto es automático. Puedes monitorear el proceso en la pestaña **Actions** de GitHub.

## Forzar una Release

Si tienes cambios que no fueron commiteados con formato semántico y quieres publicarlos ahora, puedes crear un commit vacío:

```bash
git commit --allow-empty -m "fix: trigger release for pending changes"
git push origin main
```
