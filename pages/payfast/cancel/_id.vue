<template>
  <client-only>
    <div class="container">
      <section class="home-section">
        <h3>{{ $t('orderTabbing.cancelled') }}</h3>
      </section>
    </div>
  </client-only>
</template>
<script>
  import {mapGetters, mapActions} from 'vuex'
  import global from '~/mixin/global'
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
    mixins: [global],
    computed: {
      orderId() {
        return parseInt(this.$route.params.id)
      },
    },
    methods: {
      ...mapActions('common', ['setToastMessage', 'setToastError', 'getRequest']),
    },
    async mounted() {
      this.setToastMessage(this.$t('invent.pc'))

      this.$router.push(`/user/order/${this.orderId}`)
    }
  }
</script>
