import { strict as assert } from 'node:assert';
import { findScene, SCENES } from '../../../app/module/ai/const/scene';

describe('scene pool', () => {
  it('is a non-empty list of topic + scene pairs with an icon', () => {
    assert.ok(SCENES.length > 0);
    for (const item of SCENES) {
      assert.ok(item.topic.length > 0, `topic missing for ${item.topic}`);
      assert.ok(item.scene.length > 0, `scene missing for ${item.topic}`);
      assert.ok(item.icon.length > 0, `icon missing for ${item.topic}`);
    }
  });

  it('findScene returns the matching scene for a known topic', () => {
    const item = SCENES[0];
    assert.deepEqual(findScene(item.topic), item);
  });

  it('findScene returns undefined for a topic outside the pool', () => {
    assert.equal(findScene('custom topic'), undefined);
  });
});
