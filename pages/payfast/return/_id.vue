<template>
  <client-only>
    <div class="container">
      <section class="home-section">
        <h3>{{ $t('razorpayCallback.wait') }}...</h3>
      </section>
    </div>
  </client-only>
</template>
<script>
  import global from '~/mixin/global'
  import util from '~/mixin/util'

  export default {
    middleware: ['common-middleware'],
    components: {

    },
    head(){
      return {
      }
    },
    data() {
      return {
      }
    },
    mixins: [global, util],
    computed: {
      orderId() {
        return parseInt(this.$route.params.id)
      },
    },
    methods: {
    },
    async mounted() {
      this.$router.push(`/user/order/${this.orderId}`)

    }
  }
</script>
