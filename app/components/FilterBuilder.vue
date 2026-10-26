<script setup lang="ts">
import { defaultCondition, type FieldDef, type FilterGroup, type FilterNode } from '#shared/filters'

const props = withDefaults(defineProps<{ modelValue: FilterGroup; fields: FieldDef[]; depth?: number }>(), { depth: 0 })
const emit = defineEmits<{ 'update:modelValue': [value: FilterGroup]; remove: [] }>()

function update(patch: Partial<FilterGroup>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function setChild(index: number, node: FilterNode) {
  const children = [...props.modelValue.children]
  children[index] = node
  update({ children })
}

function removeChild(index: number) {
  update({ children: props.modelValue.children.filter((_, i) => i !== index) })
}

function addCondition() {
  update({ children: [...props.modelValue.children, defaultCondition(props.fields[0]!)] })
}

function addGroup() {
  update({ children: [...props.modelValue.children, { kind: 'group', mode: 'and', children: [] }] })
}
</script>

<template>
  <div class="space-y-2" :class="depth > 0 ? 'border-l-2 border-default pl-3 py-1' : ''">
    <div class="flex items-center gap-2">
      <UButton size="xs" :variant="modelValue.mode === 'and' ? 'solid' : 'outline'" label="Toutes les conditions (ET)" @click="update({ mode: 'and' })" />
      <UButton size="xs" :variant="modelValue.mode === 'or' ? 'solid' : 'outline'" label="Au moins une (OU)" @click="update({ mode: 'or' })" />
      <UButton v-if="depth > 0" size="xs" icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Supprimer le groupe" @click="emit('remove')" />
    </div>

    <template v-for="(child, index) in modelValue.children" :key="index">
      <FilterBuilder
        v-if="child.kind === 'group'"
        :model-value="child"
        :fields="fields"
        :depth="depth + 1"
        @update:model-value="(node: FilterGroup) => setChild(index, node)"
        @remove="removeChild(index)"
      />
      <FilterConditionRow
        v-else
        :model-value="child"
        :fields="fields"
        @update:model-value="(node: FilterNode) => setChild(index, node)"
        @remove="removeChild(index)"
      />
    </template>

    <div class="flex gap-2">
      <UButton size="xs" variant="soft" icon="i-lucide-plus" label="Condition" @click="addCondition" />
      <UButton v-if="depth < 3" size="xs" variant="ghost" icon="i-lucide-brackets" label="Groupe" @click="addGroup" />
    </div>
  </div>
</template>
