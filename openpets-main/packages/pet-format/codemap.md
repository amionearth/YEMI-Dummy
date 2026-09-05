# packages/pet-format/

Minimal package providing a type marker for OpenPets package identification.

## Responsibility

Exports a simple interface and constant to identify the pet-format package in the OpenPets ecosystem. Used for type-level package identification and workspace boundary marking.

## Design

**Marker Pattern**: Provides a nominal type (`PetFormatPackageMarker`) and runtime constant (`petFormatPackageName`) for package identification without functional logic.

**Zero Dependencies**: No runtime dependencies, minimal devDependencies (TypeScript only).

## Flow

No data flow - this is a static marker package.

## Integration Points

**Consumers**: Other packages may import the marker interface for type-level package detection.

**Exports**:
- `PetFormatPackageMarker` interface with readonly `packageName`
- `petFormatPackageName` constant (`"@open-pets/pet-format"`)
