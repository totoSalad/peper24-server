## ADDED Requirements

### Requirement: Grammar corrections are unique after existing normalization

The grammar preparation service SHALL include each valid correction at most once within one analysis result. Two corrections are duplicates when their `errorType`, `original`, `corrected`, and `note` fields are all equal after the service's existing trim and length-limit normalization. The service SHALL keep the first occurrence of each duplicate, preserve the relative order of distinct corrections within each error type, and continue sorting groups by error type.

#### Scenario: Identical corrections

- **WHEN** an analysis contains two valid corrections with equal normalized values in all four fields
- **THEN** the prepared group contains one copy, corresponding to the first occurrence

#### Scenario: Different corrections

- **WHEN** two valid corrections differ in any normalized field, including `errorType`
- **THEN** both corrections remain in the prepared output

#### Scenario: Existing preparation boundaries

- **WHEN** analysis contains an explicit grammar question, invalid corrections, or more than eight raw corrections
- **THEN** the existing skip, validation, and first-eight-input limits remain in effect before duplicate removal

#### Scenario: Persisted conversation result

- **WHEN** a normal conversation analysis contains duplicate valid corrections
- **THEN** persisted grammar occurrence details and any emitted correction contain each distinct correction once, without changing the occurrence count or the correction threshold
