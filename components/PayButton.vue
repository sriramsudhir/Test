<template>
  <div class="">
    <button
      class="outline-btn plr-30"
      aria-label="submit"
      @click.prevent="payNow = true"
    >
      {{ $t('checkout.payNow') }}
    </button>
    <payment-popup
      v-if="payNow"
      :order="order"
      @close="payNow = false"
    />
  </div>

</template>
<script>

  import PaymentPopup from "./PaymentPopup";
  export default {
    name: 'PayButton',
    data() {
      return {
        payNow: false
      }
    },
    watch: {},
    props: {
      order: {
        type: Object,
        default(){
          return null
        }
      }
    },
    components: {
      PaymentPopup
    },
    computed: {

    },
    mixins: [],
    methods: {
    },
    created() {
    },
    async mounted() {
    }
  }
</script>

