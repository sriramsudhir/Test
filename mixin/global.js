import { mapGetters} from 'vuex'

export default {
  computed: {
    ...mapGetters('common', [ 'customScripts']),
  },

  mounted() {
    this.customScripts.forEach(i => {

      const regex = new RegExp(i?.route_pattern);
      const str = this.$route.path

      if (regex.test(str)) {
        if(i?.header_script){
          const script = document.createElement('script');
          script.textContent = i?.header_script_code;
          document.head.appendChild(script);
        }

        if(i?.body_script){
          const script = document.createElement('script');
          script.textContent = i?.body_script_code;
          document.body.appendChild(script);
        }
      }
    })
  },
}


