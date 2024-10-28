<template>
  <span class="lds-ring" :class="color" :style="{height: radius + 'px', width: radius + 'px'}">
    <span/>
    <span/>
    <span/>
    <span/>
  </span>
</template>

<script>

  export default {
    name: 'Spinner',

    props: {
      radius: {
        type: Number,
        default: 24,
      },
      color: {
        type: String,
        default: 'primary',
      },
    },
    computed: {},
  }
</script>
