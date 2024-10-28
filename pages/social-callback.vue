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

  export default {
    middleware: ['common-middleware', 'non-logged-in'],
    layout: "social-login",
    data() {
      return {
      }
    },
    components: {
    },
    mixins: [global],
    computed: {
      error(){
        return this.$route.query.error || null
      },
      id(){
        return this.$route.query.id || null
      },
      name(){
        return this.$route.query.name || null
      },
      email(){
        return this.$route.query.email || null
      },
      token(){
        return this.$route.query.token || null
      }
    },
    methods: {
    },
    async mounted() {

      if(this.error){
        return this.$nuxt.error({statusCode: 400, message: this.error })
      } else {
        this.$auth.setUser({
          email: this.email
        })
        await this.$auth.setUserToken('Bearer ' + this.token, null)
      }
    }
  }
</script>

<style>

</style>
