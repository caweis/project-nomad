import { test } from '@japa/runner'
import {
  classifyFileType,
  isMetadataComplete,
  INDEXABLE_EXTS,
  CATEGORY_REMAP,
} from '../../util/file_classification.js'

// ─── classifyFileType ────────────────────────────────────────────────────────

test.group('classifyFileType — known extensions', () => {
  test('STL extensions → stl', ({ assert }) => {
    assert.equal(classifyFileType('.stl'), 'stl')
    assert.equal(classifyFileType('.3mf'), 'stl')
  })

  test('CAD extensions → cad', ({ assert }) => {
    assert.equal(classifyFileType('.step'), 'cad')
    assert.equal(classifyFileType('.stp'), 'cad')
    assert.equal(classifyFileType('.dxf'), 'cad')
    assert.equal(classifyFileType('.dwg'), 'cad')
    assert.equal(classifyFileType('.f3d'), 'cad')
    assert.equal(classifyFileType('.scad'), 'cad')
  })

  test('PDF extension → pdf', ({ assert }) => {
    assert.equal(classifyFileType('.pdf'), 'pdf')
  })

  test('image extensions → image', ({ assert }) => {
    assert.equal(classifyFileType('.png'), 'image')
    assert.equal(classifyFileType('.jpg'), 'image')
    assert.equal(classifyFileType('.jpeg'), 'image')
    assert.equal(classifyFileType('.webp'), 'image')
    assert.equal(classifyFileType('.gif'), 'image')
  })

  test('unknown extensions → null', ({ assert }) => {
    assert.isNull(classifyFileType('.docx'))
    assert.isNull(classifyFileType('.exe'))
    assert.isNull(classifyFileType('.txt'))
    assert.isNull(classifyFileType(''))
    assert.isNull(classifyFileType('.'))
  })
})

test.group('classifyFileType — normalisation', () => {
  test('uppercased extensions are lowercased', ({ assert }) => {
    assert.equal(classifyFileType('.STL'), 'stl')
    assert.equal(classifyFileType('.PDF'), 'pdf')
    assert.equal(classifyFileType('.STEP'), 'cad')
    assert.equal(classifyFileType('.PNG'), 'image')
    assert.equal(classifyFileType('.3MF'), 'stl')
  })

  test('mixed case is normalised', ({ assert }) => {
    assert.equal(classifyFileType('.Stl'), 'stl')
    assert.equal(classifyFileType('.Pdf'), 'pdf')
  })

  test('extension without leading dot is handled', ({ assert }) => {
    assert.equal(classifyFileType('stl'), 'stl')
    assert.equal(classifyFileType('pdf'), 'pdf')
    assert.equal(classifyFileType('PNG'), 'image')
    assert.equal(classifyFileType('step'), 'cad')
  })
})

// ─── INDEXABLE_EXTS ──────────────────────────────────────────────────────────

test.group('INDEXABLE_EXTS', () => {
  test('contains all expected extensions', ({ assert }) => {
    const expected = [
      '.stl', '.3mf',
      '.step', '.stp', '.dxf', '.dwg', '.f3d', '.scad',
      '.pdf',
      '.png', '.jpg', '.jpeg', '.webp', '.gif',
    ]
    for (const ext of expected) {
      assert.isTrue(INDEXABLE_EXTS.has(ext), `INDEXABLE_EXTS should contain ${ext}`)
    }
  })

  test('does not contain unknown extensions', ({ assert }) => {
    assert.isFalse(INDEXABLE_EXTS.has('.docx'))
    assert.isFalse(INDEXABLE_EXTS.has('.exe'))
  })

  test('INDEXABLE_EXTS matches every key classifyFileType returns non-null for', ({ assert }) => {
    for (const ext of INDEXABLE_EXTS) {
      assert.isNotNull(
        classifyFileType(ext),
        `classifyFileType(${ext}) should return non-null for an indexable ext`
      )
    }
  })
})

// ─── isMetadataComplete ──────────────────────────────────────────────────────

test.group('isMetadataComplete — stl rules (strict)', () => {
  const fullStl = {
    file_type: 'stl',
    name: 'finger-splint',
    material: 'PLA',
    print_time_minutes: 120,
    difficulty: 'beginner',
  }

  test('complete STL row → true', ({ assert }) => {
    assert.isTrue(isMetadataComplete(fullStl))
  })

  test('missing name → false', ({ assert }) => {
    assert.isFalse(isMetadataComplete({ ...fullStl, name: null }))
    assert.isFalse(isMetadataComplete({ ...fullStl, name: '' }))
    assert.isFalse(isMetadataComplete({ ...fullStl, name: '   ' }))
  })

  test('missing material → false', ({ assert }) => {
    assert.isFalse(isMetadataComplete({ ...fullStl, material: null }))
    assert.isFalse(isMetadataComplete({ ...fullStl, material: '' }))
  })

  test('missing print_time_minutes → false', ({ assert }) => {
    assert.isFalse(isMetadataComplete({ ...fullStl, print_time_minutes: null }))
    assert.isFalse(isMetadataComplete({ ...fullStl, print_time_minutes: undefined }))
  })

  test('print_time_minutes === 0 → false', ({ assert }) => {
    assert.isFalse(isMetadataComplete({ ...fullStl, print_time_minutes: 0 }))
  })

  test('negative print_time_minutes → false', ({ assert }) => {
    assert.isFalse(isMetadataComplete({ ...fullStl, print_time_minutes: -1 }))
  })

  test('missing difficulty → false', ({ assert }) => {
    assert.isFalse(isMetadataComplete({ ...fullStl, difficulty: null }))
    assert.isFalse(isMetadataComplete({ ...fullStl, difficulty: '' }))
  })
})

test.group('isMetadataComplete — cad/pdf/image rules (name only)', () => {
  test('cad row with name → true', ({ assert }) => {
    assert.isTrue(isMetadataComplete({ file_type: 'cad', name: 'enclosure-bracket' }))
  })

  test('pdf row with name → true', ({ assert }) => {
    assert.isTrue(isMetadataComplete({ file_type: 'pdf', name: 'wiring-diagram' }))
  })

  test('image row with name → true', ({ assert }) => {
    assert.isTrue(isMetadataComplete({ file_type: 'image', name: 'antenna-photo' }))
  })

  test('cad row without name → false', ({ assert }) => {
    assert.isFalse(isMetadataComplete({ file_type: 'cad', name: null }))
    assert.isFalse(isMetadataComplete({ file_type: 'cad', name: '' }))
    assert.isFalse(isMetadataComplete({ file_type: 'cad', name: '   ' }))
  })

  test('non-stl with material/difficulty still only needs name', ({ assert }) => {
    // These extra fields are irrelevant for non-STL — name alone is enough.
    assert.isTrue(
      isMetadataComplete({ file_type: 'pdf', name: 'guide', material: null, difficulty: null })
    )
  })
})

// ─── CATEGORY_REMAP ──────────────────────────────────────────────────────────

test.group('CATEGORY_REMAP — all 7 old values', () => {
  // The two values that actually change:
  test('tools → tools-hardware', ({ assert }) => {
    assert.equal(CATEGORY_REMAP['tools'], 'tools-hardware')
  })

  test('agriculture → agriculture-homestead', ({ assert }) => {
    assert.equal(CATEGORY_REMAP['agriculture'], 'agriculture-homestead')
  })

  // The five that must NOT be in the remap map (they carry forward unchanged):
  test('unchanged values are not in the remap map', ({ assert }) => {
    const unchanged = ['medical', 'replacement-parts', 'household', 'firearm-accessories', 'other']
    for (const cat of unchanged) {
      assert.isUndefined(
        CATEGORY_REMAP[cat],
        `${cat} should not be remapped (it is valid in the new 14-set as-is)`
      )
    }
  })

  test('remap has exactly 2 entries', ({ assert }) => {
    assert.equal(Object.keys(CATEGORY_REMAP).length, 2)
  })
})
