<!-- @app
{
  "title": "Denorite",
  "name": "DenoriteApp",
  "icon": "items/dragon_breath.png",
  "description": "This is a self-contained component app",
  "version": "1.0.0",
  "permission": "operator",
  "singleWindow": false,
  "height": 400,
  "width": 100,
  "isClosable": true
}
-->

<template>
  <Button>
  Hello World
  </Button>
  {{enchanted.isSynced}}
  {{enchanted.username}}
</template>

<script setup lang="ts">

const test = ref('Janis')
</script>

<style scoped>
/* Add your component styles here */
</style>
