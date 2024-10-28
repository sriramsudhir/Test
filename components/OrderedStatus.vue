<template>
  <div class="order-status">
    <div
      v-for="(value, index) in orderStatus" :key="index"
      class="status-item"
      :class="[{done: index < statusOfOrder}, {active: parseInt(index) === statusOfOrder}]"
    >
      <span class="flex"><b>{{ index }}</b></span>
      <span class="f-9 bold status-str mtb-10">{{ value.title }}</span>
    </div>
  </div>

</template>

<script>
  import util from '~/mixin/util'

  export default {
    name: 'OrderedStatus',
    components: {},
    directives: {},
    props: {
      statusOfOrder: {
        type: Number,
        required: true
      }
    },
    mixins: [util],
    watch: {

    },
    computed: {

    },
    data() {
      return{

      }
    },
    methods: {

    },
    async mounted() {
    },
    destroyed() {
    }
  }
</script>
