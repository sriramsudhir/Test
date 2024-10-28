<template>
  <ul
    class="error-list mb-15"
    v-if="errors.length"
  >
    <li
      class="mb-10"
    >
      {{ $t('forgotPassword.errorOccurred') }}
    </li>
    <li
      v-for="(value, index) in errors"
      :key="index"
    >
      {{ value }}
    </li>
  </ul>
</template>

<script>

  export default {
    name: 'ErrorHandler',
    props: {
      errors: {
        type: Array,
        default:[],
      },
    },
    data() {
      return {
      }
    },
    components: {

    },
    mixins: [],
    computed: {
    },
    mounted() {
    },
    methods: {
    },
  };
</script>

