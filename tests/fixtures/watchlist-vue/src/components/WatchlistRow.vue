<script setup lang="ts">
import { computed } from 'vue';

export interface Quote {
  symbol: string;
  last: number;
  changePercent: number;
}

const props = defineProps<{ quote: Quote }>();
const emit = defineEmits<{ remove: [symbol: string] }>();
const direction = computed(() => (props.quote.changePercent >= 0 ? 'up' : 'down'));
</script>

<template>
  <tr data-test="watchlist-row" :data-direction="direction">
    <td>{{ quote.symbol }}</td>
    <td>{{ quote.last.toFixed(2) }}</td>
    <td>{{ quote.changePercent > 0 ? '+' : '' }}{{ quote.changePercent.toFixed(2) }}%</td>
    <td><button type="button" @click="emit('remove', quote.symbol)">Remove</button></td>
  </tr>
</template>
