<script setup lang="ts">
import { computed, ref } from 'vue';
import WatchlistRow, { type Quote } from './WatchlistRow.vue';

const props = defineProps<{ quotes: Quote[]; delayedMinutes?: number }>();
const emit = defineEmits<{ remove: [symbol: string] }>();
const byChange = ref(false);
const rows = computed(() =>
  byChange.value ? [...props.quotes].sort((a, b) => b.changePercent - a.changePercent) : props.quotes,
);
</script>

<template>
  <p v-if="delayedMinutes" data-test="delay-banner">Quotes are delayed by {{ delayedMinutes }} minutes</p>
  <table>
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Last</th>
        <th><button type="button" data-test="sort-by-change" @click="byChange = !byChange">Change</button></th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <WatchlistRow v-for="quote in rows" :key="quote.symbol" :quote="quote" @remove="emit('remove', $event)" />
    </tbody>
  </table>
</template>
