<script setup lang="ts">
import { OPERATORS, defaultCondition, defaultValue, type FieldDef, type FilterCondition, type FilterField, type FilterValue, type Op } from '#shared/filters'

const props = defineProps<{ modelValue: FilterCondition; fields: FieldDef[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: FilterCondition]; remove: [] }>()

const field = computed(() => props.fields.find(f => f.key === props.modelValue.field) ?? props.fields[0]!)
const ops = computed(() => OPERATORS[field.value.type])
const opDef = computed(() => ops.value.find(o => o.op === props.modelValue.op) ?? ops.value[0]!)
const fieldItems = computed(() => props.fields.map(f => ({ label: f.label, value: f.key })))
const opItems = computed(() => ops.value.map(o => ({ label: o.label, value: o.op })))
const optionItems = computed(() => (field.value.options ?? []).map(o => ({ label: o.label, value: o.value })))
const isNumber = computed(() => field.value.type === 'number')

function setField(value: unknown) {
  const next = props.fields.find(f => f.key === (value as FilterField))
  if (next) emit('update:modelValue', defaultCondition(next))
}

function setOp(value: unknown) {
  const def = ops.value.find(o => o.op === (value as Op))
  if (def) emit('update:modelValue', { ...props.modelValue, op: def.op, value: defaultValue(field.value, def.value) })
}

function setValue(value: FilterValue) {
  emit('update:modelValue', { ...props.modelValue, value })
}

function setSingle(value: unknown) {
  setValue(toFilterValue('single', field.value.type, value))
}

function setDays(value: unknown) {
  setValue(toFilterValue('days', field.value.type, value))
}

function setDate(value: unknown) {
  setValue(toFilterValue('date', field.value.type, value))
}

function setPair(index: 0 | 1, value: unknown) {
  const pair: unknown[] = Array.isArray(props.modelValue.value) ? [...props.modelValue.value] : [null, null]
  pair[index] = value
  setValue(toFilterValue('pair', field.value.type, pair))
}

function setMulti(value: unknown) {
  setValue(toFilterValue('multi', field.value.type, value))
}

const single = computed(() => (props.modelValue.value ?? '') as string | number)
const numeric = (v: unknown) => (typeof v === 'number' ? v : undefined)
const pair = computed(() => (Array.isArray(props.modelValue.value) ? props.modelValue.value : [null, null]) as (number | null)[])
const multi = computed(() => (Array.isArray(props.modelValue.value) ? props.modelValue.value.map(String) : []))
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <USelect :model-value="modelValue.field" :items="fieldItems" class="w-56" @update:model-value="setField" />
    <USelect :model-value="modelValue.op" :items="opItems" class="w-52" @update:model-value="setOp" />

    <template v-if="opDef.value === 'single'">
      <USelectMenu
        v-if="optionItems.length"
        :model-value="String(single)"
        :items="optionItems"
        value-key="value"
        class="w-56"
        @update:model-value="setSingle"
      />
      <UInputNumber v-else-if="isNumber" :model-value="numeric(single)" :step="field.unit === 'Go' ? 0.5 : 1" class="w-36" @update:model-value="setSingle" />
      <UInput v-else :model-value="String(single)" class="w-56" @update:model-value="setSingle" />
      <span v-if="field.unit" class="text-sm text-muted">{{ field.unit }}</span>
    </template>

    <template v-else-if="opDef.value === 'pair'">
      <UInputNumber :model-value="numeric(pair[0])" class="w-32" @update:model-value="(v: unknown) => setPair(0, v)" />
      <span class="text-sm text-muted">et</span>
      <UInputNumber :model-value="numeric(pair[1])" class="w-32" @update:model-value="(v: unknown) => setPair(1, v)" />
    </template>

    <template v-else-if="opDef.value === 'multi'">
      <USelectMenu v-if="optionItems.length" :model-value="multi" :items="optionItems" value-key="value" multiple class="w-72" @update:model-value="setMulti" />
      <UInputTags v-else :model-value="multi" placeholder="Valeur puis Entrée" class="w-72" @update:model-value="setMulti" />
    </template>

    <template v-else-if="opDef.value === 'days'">
      <UInputNumber :model-value="numeric(single)" :min="0" class="w-32" @update:model-value="setDays" />
      <span class="text-sm text-muted">jours</span>
    </template>

    <UInput v-else-if="opDef.value === 'date'" type="date" :model-value="String(single)" class="w-44" @update:model-value="setDate" />

    <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" aria-label="Supprimer la condition" @click="emit('remove')" />
  </div>
</template>
